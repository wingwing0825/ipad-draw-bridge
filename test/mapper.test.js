const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapCanvasToScreen,
  normalizeRegion,
  mapCanvasToRegion
} = require("../src/mapper");

test("mapCanvasToScreen maps center point", () => {
  const mapped = mapCanvasToScreen({
    x: 500,
    y: 500,
    canvasWidth: 1000,
    canvasHeight: 1000,
    screenWidth: 1920,
    screenHeight: 1080
  });

  assert.deepEqual(mapped, { x: 960, y: 540 });
});

test("mapCanvasToScreen clamps values outside canvas", () => {
  const mapped = mapCanvasToScreen({
    x: -100,
    y: 2000,
    canvasWidth: 1000,
    canvasHeight: 1000,
    screenWidth: 1920,
    screenHeight: 1080
  });

  assert.deepEqual(mapped, { x: 0, y: 1079 });
});

test("mapCanvasToScreen returns null for invalid input", () => {
  const mapped = mapCanvasToScreen({
    x: 0,
    y: 0,
    canvasWidth: 0,
    canvasHeight: 1000,
    screenWidth: 1920,
    screenHeight: 1080
  });

  assert.equal(mapped, null);
});

test("normalizeRegion clamps region to screen", () => {
  const normalized = normalizeRegion(
    {
      x: -50,
      y: 10,
      width: 5000,
      height: 3000
    },
    { width: 1920, height: 1080 }
  );

  assert.deepEqual(normalized, {
    x: 0,
    y: 10,
    width: 1920,
    height: 1070
  });
});

test("mapCanvasToRegion maps canvas point into region", () => {
  const mapped = mapCanvasToRegion({
    x: 500,
    y: 500,
    canvasWidth: 1000,
    canvasHeight: 1000,
    region: { x: 100, y: 200, width: 800, height: 600 }
  });

  assert.deepEqual(mapped, {
    x: 500,
    y: 500
  });
});

test("mapCanvasToRegion maps far edge to region boundary", () => {
  const mapped = mapCanvasToRegion({
    x: 1000,
    y: 1000,
    canvasWidth: 1000,
    canvasHeight: 1000,
    region: { x: 100, y: 200, width: 800, height: 600 }
  });

  assert.deepEqual(mapped, {
    x: 899,
    y: 799
  });
});
