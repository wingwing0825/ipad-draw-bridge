const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBridgeServer } = require("../src/bridgeServer");

test("bridge server returns EADDRINUSE when port is occupied without crashing", async (t) => {
  const first = createBridgeServer({
    port: 0,
    requireToken: false
  });
  const firstStatus = await first.start();
  t.after(async () => {
    await first.stop();
  });

  const second = createBridgeServer({
    port: firstStatus.port,
    requireToken: false
  });

  await assert.rejects(
    () => second.start(),
    (error) => {
      return Boolean(error && error.code === "EADDRINUSE");
    }
  );

  await second.stop();
});

test("preview mode defaults to true and can be toggled", async (t) => {
  const statePath = path.join(
    os.tmpdir(),
    `ipad-draw-bridge-state-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const bridge = createBridgeServer({
    port: 0,
    requireToken: false,
    statePath
  });

  await bridge.start();
  t.after(async () => {
    await bridge.stop();
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  });

  assert.equal(bridge.getStatus().previewEnabled, true);
  bridge.setPreviewEnabled(false);
  assert.equal(bridge.getStatus().previewEnabled, false);
  bridge.setPreviewEnabled(true);
  assert.equal(bridge.getStatus().previewEnabled, true);
});
