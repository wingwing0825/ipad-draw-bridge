const path = require("node:path");
const { app, BrowserWindow, ipcMain, clipboard, shell, screen } = require("electron");
const { createBridgeServer } = require("../src/bridgeServer");
const { buildDrawUrl, generatePairToken } = require("../src/security");

let mainWindow = null;
let overlayWindow = null;
let bridge = null;

const preferredPort = Number(process.env.PORT || 8090);
const userStatePath = () => path.join(app.getPath("userData"), "bridge-state.json");

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "ui.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-finish-load", () => {
    notifyStatus();
  });
}

async function startBridge() {
  if (bridge && bridge.isRunning()) {
    return getStatusPayload();
  }

  if (!bridge) {
    bridge = await createAndStartBridge();
  } else {
    await bridge.start();
  }

  notifyStatus();
  return getStatusPayload();
}

async function stopBridge() {
  if (!bridge) {
    return getStatusPayload();
  }

  await bridge.stop();
  bridge = null;
  closeOverlayWindow();
  notifyStatus();
  return getStatusPayload();
}

async function regenerateToken() {
  await stopBridge();
  bridge = await createAndStartBridge();
  notifyStatus();
  return getStatusPayload();
}

async function createAndStartBridge() {
  const token = generatePairToken(10);
  let lastError = null;

  for (let step = 0; step < 6; step += 1) {
    const port = preferredPort + step;
    const candidate = createBridgeServer({
      port,
      requireToken: true,
      token,
      statePath: userStatePath()
    });

    try {
      await candidate.start();
      return candidate;
    } catch (error) {
      lastError = error;
      await candidate.stop().catch(() => {});
      if (!error || error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw lastError || new Error("Failed to start bridge server.");
}

function closeOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

function openOverlayWindow(options = {}) {
  if (!bridge || !bridge.isRunning()) {
    return false;
  }

  const reselect = Boolean(options && options.reselect);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (reselect) {
      overlayWindow.close();
      overlayWindow = null;
    } else {
      overlayWindow.focus();
      return true;
    }
  }

  const primary = screen.getPrimaryDisplay();
  const bounds = primary && primary.bounds ? primary.bounds : { x: 0, y: 0, width: 1280, height: 720 };
  const width = Math.max(1, Number(bounds.width));
  const height = Math.max(1, Number(bounds.height));
  const x = Number(bounds.x) || 0;
  const y = Number(bounds.y) || 0;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  overlayWindow.setMenuBarVisibility(false);
  if (reselect) {
    overlayWindow.loadFile(path.join(__dirname, "overlay-app.html"), {
      query: { reselect: "1" }
    });
  } else {
    overlayWindow.loadFile(path.join(__dirname, "overlay-app.html"));
  }

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return true;
}

function getStatusPayload() {
  if (!bridge || !bridge.isRunning()) {
    return {
      running: false
    };
  }

  const status = bridge.getStatus();
  const fallbackUrl = buildDrawUrl("localhost", status.port, status.token, status.requireToken);

  return {
    ...status,
    primaryDrawUrl: status.drawUrls[0] || fallbackUrl
  };
}

function getOverlayModel() {
  if (!bridge || !bridge.isRunning()) {
    return null;
  }

  const status = bridge.getStatus();
  const region = status.region || {
    x: 0,
    y: 0,
    width: status.screen.width,
    height: status.screen.height
  };

  return {
    screen: status.screen,
    region
  };
}

function notifyStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("bridge:status", getStatusPayload());
}

function registerIpcHandlers() {
  ipcMain.handle("bridge:get-status", () => getStatusPayload());

  ipcMain.handle("bridge:start", async () => {
    return startBridge();
  });

  ipcMain.handle("bridge:stop", async () => {
    return stopBridge();
  });

  ipcMain.handle("bridge:regenerate-token", async () => {
    return regenerateToken();
  });

  ipcMain.handle("bridge:open-overlay", (_event, options) => {
    return openOverlayWindow(options);
  });

  ipcMain.handle("bridge:clear-region", () => {
    if (!bridge || !bridge.isRunning()) {
      return null;
    }
    bridge.clearRegion();
    notifyStatus();
    return bridge.getStatus().region;
  });

  ipcMain.handle("bridge:release-pointer", () => {
    if (!bridge || !bridge.isRunning()) {
      return false;
    }
    bridge.releasePointer();
    return true;
  });

  ipcMain.handle("bridge:set-preview-enabled", (_event, enabled) => {
    if (!bridge || !bridge.isRunning()) {
      return null;
    }
    const next = bridge.setPreviewEnabled(Boolean(enabled));
    notifyStatus();
    return next;
  });

  ipcMain.handle("bridge:copy-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });

  ipcMain.handle("bridge:open-external", (_event, url) => {
    if (!url) {
      return false;
    }
    shell.openExternal(String(url));
    return true;
  });

  ipcMain.handle("overlay:get-model", () => getOverlayModel());

  ipcMain.handle("overlay:apply-region", (_event, region) => {
    if (!bridge || !bridge.isRunning()) {
      return { ok: false, reason: "Bridge is not running." };
    }
    const saved = bridge.setRegion(region);
    if (!saved) {
      return { ok: false, reason: "Invalid region." };
    }
    notifyStatus();
    return { ok: true, region: saved };
  });

  ipcMain.handle("overlay:close", () => {
    closeOverlayWindow();
    return true;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  try {
    await startBridge();
  } catch (error) {
    console.error(`[fatal] Failed to start bridge: ${error.message}`);
    notifyStatus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  if (bridge && bridge.isRunning()) {
    bridge.stop().catch(() => {});
  }
});
