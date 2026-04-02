const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { WebSocketServer } = require("ws");
const {
  setupMouseController,
  getScreenSize,
  moveMouse,
  mouseDown,
  mouseUp,
  forceMouseDown,
  forceMouseUp,
  ensureMouseReleased
} = require("./mouseController");
const { mapCanvasToRegion, normalizeRegion } = require("./mapper");
const {
  sanitizeToken,
  generatePairToken,
  buildDrawUrl,
  isLoopbackAddress
} = require("./security");

const STROKE_TIMEOUT_MS = 900;
const SOCKET_OPEN = 1;

function createBridgeServer(options = {}) {
  const configuredPort =
    options.port !== undefined && options.port !== null
      ? Number(options.port)
      : Number(process.env.PORT || 8090);
  const host = String(options.host || "0.0.0.0");
  const publicDir = options.publicDir || path.join(__dirname, "..", "public");
  const statePath = options.statePath || path.join(__dirname, "..", "bridge-state.json");
  const requireToken = Boolean(options.requireToken);
  const logger = options.logger || console;

  const initialToken = sanitizeToken(options.token || process.env.BRIDGE_TOKEN || "");
  const runtime = {
    state: loadStateFromDisk(statePath),
    activeSocket: null,
    strokeActive: false,
    currentStrokeId: null,
    reassertDownPending: false,
    eventStats: createEmptyEventStats(),
    lastEventAt: 0,
    token: initialToken || (requireToken ? generatePairToken(10) : ""),
    listeningPort: null
  };

  const mouseSetup = setupMouseController();
  if (!mouseSetup.available && logger && typeof logger.warn === "function") {
    logger.warn(`[warn] Mouse control not active: ${mouseSetup.reason}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Internal server error" });
    }
  });

  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: false
  });

  wss.on("error", (error) => {
    if (logger && typeof logger.warn === "function") {
      logger.warn(`[warn] websocket server error: ${error.message}`);
    }
  });

  let watchdogTimer = null;
  let started = false;

  wss.on("connection", (ws, req) => {
    const reqUrl = parseRequestUrl(req.url);
    if (!isTokenAllowed(reqUrl, req.headers)) {
      ws.close(1008, "Unauthorized");
      return;
    }

    if (runtime.activeSocket && runtime.activeSocket.readyState === SOCKET_OPEN) {
      ws.send(JSON.stringify({ type: "busy", message: "Another iPad is connected." }));
      ws.close(1008, "Busy");
      return;
    }

    runtime.activeSocket = ws;
    if (ws._socket) {
      ws._socket.setNoDelay(true);
    }

    ws.send(
      JSON.stringify({
        type: "ready",
        region: getEffectiveRegion(),
        previewEnabled: getPreviewEnabled()
      })
    );

    ws.on("message", (rawData) => {
      const payload = parsePointerEvent(rawData);
      if (!payload) {
        return;
      }
      handlePointerEvent(payload);
    });

    ws.on("close", () => {
      if (runtime.activeSocket === ws) {
        runtime.activeSocket = null;
      }
      endStroke();
    });

    ws.on("error", () => {
      endStroke();
    });
  });

  function handlePointerEvent(payload) {
    bumpEventStat(`rx${capitalizeType(payload.type)}`);

    const region = getEffectiveRegion();
    const mapped = mapCanvasToRegion({
      x: Number(payload.x),
      y: Number(payload.y),
      canvasWidth: Number(payload.canvasWidth),
      canvasHeight: Number(payload.canvasHeight),
      region
    });

    if (!mapped) {
      return;
    }

    runtime.lastEventAt = Date.now();
    const strokeId = normalizeStrokeId(payload.strokeId);

    if (payload.type === "down") {
      beginStroke(mapped, strokeId);
      return;
    }

    if (payload.type === "move") {
      if (!runtime.strokeActive) {
        bumpEventStat("ignoredMoveNoStroke");
        return;
      }
      if (isDifferentStroke(strokeId)) {
        bumpEventStat("ignoredStrokeMismatch");
        return;
      }
      if (runtime.reassertDownPending) {
        const reasserted = forceMouseDown();
        if (reasserted) {
          bumpEventStat("reassertDownOk");
        } else {
          bumpEventStat("reassertDownFail");
        }
        runtime.reassertDownPending = false;
      }
      moveMouse(mapped.x, mapped.y);
      bumpEventStat("moveApplied");
      return;
    }

    if (payload.type === "up" || payload.type === "cancel") {
      if (payload.type === "up" && isDifferentStroke(strokeId)) {
        bumpEventStat("ignoredStrokeMismatch");
        return;
      }
      if (runtime.strokeActive) {
        moveMouse(mapped.x, mapped.y);
        bumpEventStat(payload.type === "up" ? "upApplied" : "cancelApplied");
        endStroke();
      } else {
        forceMouseUp();
        bumpEventStat("forcedUpNoStroke");
      }
    }
  }

  function beginStroke(mapped, strokeId) {
    if (runtime.strokeActive) {
      endStroke();
    } else {
      ensureMouseReleased();
    }

    moveMouse(mapped.x, mapped.y);
    const downOk = mouseDown();
    runtime.strokeActive = Boolean(downOk);
    runtime.currentStrokeId = downOk ? strokeId : null;
    runtime.reassertDownPending = Boolean(downOk);

    if (downOk) {
      bumpEventStat("downApplied");
    } else {
      bumpEventStat("downFailed");
    }

    if (!downOk) {
      ensureMouseReleased();
    }
  }

  function normalizeStrokeId(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return null;
    }
    const normalized = Math.trunc(n);
    return normalized > 0 ? normalized : null;
  }

  function isDifferentStroke(strokeId) {
    if (strokeId === null || runtime.currentStrokeId === null) {
      return false;
    }
    return strokeId !== runtime.currentStrokeId;
  }

  async function routeRequest(req, res) {
    const reqUrl = parseRequestUrl(req.url);
    const pathname = reqUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      if (!isTokenAllowed(reqUrl, req.headers)) {
        return sendUnauthorizedPage(res);
      }
      return sendFile(res, publicDir, "index.html");
    }

    if (pathname === "/control" || pathname === "/control.html") {
      return sendFile(res, publicDir, "control.html");
    }

    if (pathname === "/overlay" || pathname === "/overlay.html") {
      return sendFile(res, publicDir, "overlay.html");
    }

    if (pathname === "/api/config") {
      if (!isApiCallerAllowed(req, reqUrl)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      return sendJson(res, 200, getConfig());
    }

    if (pathname === "/api/region" && req.method === "POST") {
      if (!isApiCallerAllowed(req, reqUrl)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }

      const body = await readJsonBody(req);
      const screen = getScreenSize();
      const region = normalizeRegion(body, screen);
      if (!region) {
        return sendJson(res, 400, { error: "Invalid region. Expect x,y,width,height." });
      }

      setRegion(region);
      return sendJson(res, 200, { ok: true, region });
    }

    if (pathname === "/api/region" && req.method === "DELETE") {
      if (!isApiCallerAllowed(req, reqUrl)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      clearRegion();
      return sendJson(res, 200, { ok: true, region: null });
    }

    if (pathname === "/api/preview" && req.method === "POST") {
      if (!isApiCallerAllowed(req, reqUrl)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      const body = await readJsonBody(req);
      if (!Object.prototype.hasOwnProperty.call(body, "enabled")) {
        return sendJson(res, 400, { error: "Missing field: enabled" });
      }
      const enabled = setPreviewEnabled(Boolean(body.enabled));
      return sendJson(res, 200, { ok: true, enabled });
    }

    if (pathname === "/api/release" && req.method === "POST") {
      if (!isApiCallerAllowed(req, reqUrl)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      releasePointer();
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: "Not found" });
  }

  function isApiCallerAllowed(req, reqUrl) {
    const remoteAddress = normalizeIp(getRemoteAddress(req));
    if (isLoopbackAddress(remoteAddress)) {
      return true;
    }

    if (getLocalIPv4().includes(remoteAddress)) {
      return true;
    }

    // Remote API access is blocked by default. The only accepted remote case
    // is a valid pair token in query or header.
    return isTokenAllowed(reqUrl, req.headers);
  }

  function getRemoteAddress(req) {
    if (!req || !req.socket) {
      return "";
    }
    return String(req.socket.remoteAddress || "");
  }

  function isTokenAllowed(reqUrl, headers = {}) {
    if (!requireToken) {
      return true;
    }

    const queryToken = sanitizeToken(reqUrl.searchParams.get("token") || "");
    if (queryToken && queryToken === runtime.token) {
      return true;
    }

    const headerToken = sanitizeToken(String(headers["x-bridge-token"] || ""));
    return Boolean(headerToken && headerToken === runtime.token);
  }

  function getEffectiveRegion() {
    const screen = getScreenSize();
    const region = normalizeRegion(runtime.state.region, screen);
    if (region) {
      return region;
    }
    return {
      x: 0,
      y: 0,
      width: screen.width,
      height: screen.height
    };
  }

  function getConfig() {
    const screen = getScreenSize();
    const region = normalizeRegion(runtime.state.region, screen);
    return {
      screen,
      region,
      previewEnabled: getPreviewEnabled()
    };
  }

  function setRegion(regionInput) {
    const screen = getScreenSize();
    const region = normalizeRegion(regionInput, screen);
    if (!region) {
      return null;
    }

    runtime.state = {
      ...runtime.state,
      region
    };
    saveStateToDisk(statePath, runtime.state);
    notifyActiveClient({
      type: "region",
      region: getEffectiveRegion()
    });
    return region;
  }

  function clearRegion() {
    runtime.state = {
      ...runtime.state,
      region: null
    };
    saveStateToDisk(statePath, runtime.state);
    notifyActiveClient({
      type: "region",
      region: getEffectiveRegion()
    });
  }

  function getPreviewEnabled() {
    return runtime.state.previewEnabled !== false;
  }

  function setPreviewEnabled(enabledInput) {
    const enabled = Boolean(enabledInput);
    runtime.state = {
      ...runtime.state,
      previewEnabled: enabled
    };
    saveStateToDisk(statePath, runtime.state);
    notifyActiveClient({
      type: "preview",
      enabled
    });
    return enabled;
  }

  function releasePointer() {
    endStroke();
  }

  function notifyActiveClient(payload) {
    if (!runtime.activeSocket || runtime.activeSocket.readyState !== SOCKET_OPEN) {
      return;
    }
    try {
      runtime.activeSocket.send(JSON.stringify(payload));
    } catch {
      // Ignore push failures.
    }
  }

  function endStroke() {
    forceMouseUp();
    ensureMouseReleased();
    runtime.strokeActive = false;
    runtime.currentStrokeId = null;
    runtime.reassertDownPending = false;
  }

  async function start() {
    if (started) {
      return getStatus();
    }

    await new Promise((resolve, reject) => {
      function onError(error) {
        server.off("listening", onListening);
        reject(error);
      }

      function onListening() {
        server.off("error", onError);
        resolve();
      }

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(configuredPort, host);
    });

    const address = server.address();
    runtime.listeningPort = address && typeof address === "object" ? address.port : configuredPort;
    started = true;
    watchdogTimer = setInterval(() => {
      if (!runtime.strokeActive) {
        return;
      }
      if (Date.now() - runtime.lastEventAt > STROKE_TIMEOUT_MS) {
        endStroke();
      }
    }, 250);
    watchdogTimer.unref();

    return getStatus();
  }

  async function stop() {
    endStroke();
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }

    await closeAllClients(wss);
    await closeWebSocketServer(wss);
    await closeHttpServer(server);

    runtime.activeSocket = null;
    runtime.listeningPort = null;
    started = false;
  }

  function isRunning() {
    return started;
  }

  function getStatus() {
    const screen = getScreenSize();
    const region = normalizeRegion(runtime.state.region, screen);
    const ips = getLocalIPv4();
    const port = runtime.listeningPort || configuredPort;
    const drawUrls = ips.map((ip) => buildDrawUrl(ip, port, runtime.token, requireToken));
    const controlUrls = ips.map((ip) => `http://${ip}:${port}/control`);
    const overlayUrls = ips.map((ip) => `http://${ip}:${port}/overlay`);

    return {
      running: started,
      host,
      port,
      token: runtime.token,
      requireToken,
      screen,
      region,
      previewEnabled: getPreviewEnabled(),
      hostIps: ips,
      drawUrls,
      controlUrls,
      overlayUrls,
      eventStats: { ...runtime.eventStats }
    };
  }

  function bumpEventStat(key) {
    runtime.eventStats = {
      ...runtime.eventStats,
      [key]: (runtime.eventStats[key] || 0) + 1
    };
  }

  function parseRequestUrl(rawUrl) {
    try {
      return new URL(rawUrl || "/", "http://localhost");
    } catch {
      return new URL("/", "http://localhost");
    }
  }

  return {
    start,
    stop,
    isRunning,
    getStatus,
    getConfig,
    setRegion,
    clearRegion,
    setPreviewEnabled,
    releasePointer,
    getToken: () => runtime.token
  };
}

function parsePointerEvent(rawData) {
  const raw = rawData.toString("utf8").trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidPointerEvent(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  const parts = raw.split("|");
  if (parts.length !== 5 && parts.length !== 6) {
    return null;
  }

  const typeMap = {
    d: "down",
    m: "move",
    u: "up",
    c: "cancel"
  };

  const type = typeMap[parts[0]];
  if (!type) {
    return null;
  }

  const parsed = {
    type,
    x: Number(parts[1]),
    y: Number(parts[2]),
    canvasWidth: Number(parts[3]),
    canvasHeight: Number(parts[4]),
    strokeId: parts.length === 6 ? Number(parts[5]) : null
  };

  return isValidPointerEvent(parsed) ? parsed : null;
}

function createEmptyEventStats() {
  return {
    rxDown: 0,
    rxMove: 0,
    rxUp: 0,
    rxCancel: 0,
    downApplied: 0,
    downFailed: 0,
    reassertDownOk: 0,
    reassertDownFail: 0,
    moveApplied: 0,
    upApplied: 0,
    cancelApplied: 0,
    ignoredMoveNoStroke: 0,
    ignoredStrokeMismatch: 0,
    forcedUpNoStroke: 0
  };
}

function capitalizeType(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isValidPointerEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (!["down", "move", "up", "cancel"].includes(payload.type)) {
    return false;
  }

  const numbers = [payload.x, payload.y, payload.canvasWidth, payload.canvasHeight];
  if (!numbers.every((value) => Number.isFinite(Number(value)))) {
    return false;
  }

  if (payload.strokeId === null || payload.strokeId === undefined) {
    return true;
  }

  return Number.isFinite(Number(payload.strokeId));
}

function sendUnauthorizedPage(res) {
  res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><html><body style='font-family:Segoe UI;padding:24px'><h2>Unauthorized</h2><p>This bridge requires a pair token from the desktop app.</p></body></html>"
  );
}

function sendFile(res, publicDir, filename) {
  const contentType = filename.endsWith(".html")
    ? "text/html; charset=utf-8"
    : "text/plain; charset=utf-8";

  const filePath = path.join(publicDir, filename);
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (error, content) => {
      if (error) {
        reject(error);
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      resolve();
    });
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });
    req.on("error", reject);
  });
}

function loadStateFromDisk(statePath) {
  try {
    if (!fs.existsSync(statePath)) {
      return { region: null, previewEnabled: true };
    }

    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      region: parsed.region || null,
      previewEnabled: parsed.previewEnabled !== false
    };
  } catch {
    return { region: null, previewEnabled: true };
  }
}

function saveStateToDisk(statePath, state) {
  try {
    const folder = path.dirname(statePath);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          region: state.region || null,
          previewEnabled: state.previewEnabled !== false
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // ignore persistence failure and continue runtime operation
  }
}

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const filtered = [];
  const fallback = [];

  for (const [name, details] of Object.entries(interfaces)) {
    const list = details || [];
    for (const detail of list) {
      if (!detail || detail.family !== "IPv4" || detail.internal) {
        continue;
      }

      fallback.push(detail.address);
      if (detail.address.startsWith("169.254.")) {
        continue;
      }
      if (isLikelyVirtualInterface(name)) {
        continue;
      }
      filtered.push(detail.address);
    }
  }

  const selected = filtered.length > 0 ? filtered : fallback;
  return unique(selected).sort(scoreIp);
}

function normalizeIp(address) {
  const value = String(address || "");
  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }
  return value;
}

function scoreIp(a, b) {
  return ipScore(a) - ipScore(b);
}

function ipScore(ip) {
  if (ip.startsWith("192.168.")) {
    return 1;
  }
  if (ip.startsWith("10.")) {
    return 2;
  }
  if (ip.startsWith("172.")) {
    return 3;
  }
  if (ip.startsWith("169.254.")) {
    return 9;
  }
  return 5;
}

function isLikelyVirtualInterface(name) {
  const lower = String(name || "").toLowerCase();
  return (
    lower.includes("virtual") ||
    lower.includes("vethernet") ||
    lower.includes("hyper-v") ||
    lower.includes("vmware") ||
    lower.includes("wireguard") ||
    lower.includes("loopback") ||
    lower.includes("bluetooth") ||
    lower.includes("tap") ||
    lower.includes("tun")
  );
}

function unique(values) {
  return [...new Set(values)];
}

function closeAllClients(wss) {
  return Promise.resolve().then(() => {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore close errors
      }
    }
  });
}

function closeWebSocketServer(wss) {
  return new Promise((resolve) => {
    try {
      wss.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

module.exports = {
  createBridgeServer
};
