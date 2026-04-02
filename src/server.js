const { createBridgeServer } = require("./bridgeServer");
const { sanitizeToken, generatePairToken } = require("./security");

const requireToken = process.env.BRIDGE_INSECURE !== "1";
const configuredToken = sanitizeToken(process.env.BRIDGE_TOKEN || "");
const token = requireToken ? configuredToken || generatePairToken(10) : "";

const bridge = createBridgeServer({
  port: Number(process.env.PORT || 8090),
  requireToken,
  token
});

let shuttingDown = false;

bridge
  .start()
  .then((status) => {
    printStartup(status);
  })
  .catch((error) => {
    console.error(`[fatal] failed to start bridge: ${error.message}`);
    process.exit(1);
  });

function printStartup(status) {
  console.log(`iPad Draw Bridge is running on port ${status.port}`);
  if (status.requireToken) {
    console.log(`Pair token: ${status.token}`);
  } else {
    console.log("Security mode: INSECURE (BRIDGE_INSECURE=1)");
  }

  if (status.drawUrls.length === 0) {
    console.log(`iPad draw page: http://localhost:${status.port}`);
    console.log(`Control panel: http://localhost:${status.port}/control`);
    console.log(`Overlay picker: http://localhost:${status.port}/overlay`);
    return;
  }

  status.drawUrls.forEach((url) => {
    const base = url.replace(/\/\?token=.*/, "");
    console.log(`iPad draw page: ${url}`);
    console.log(`Control panel: ${base}/control`);
    console.log(`Overlay picker: ${base}/overlay`);
  });
}

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  try {
    await bridge.stop();
  } catch (error) {
    console.error(`[warn] failed to close cleanly: ${error.message}`);
  }
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});
