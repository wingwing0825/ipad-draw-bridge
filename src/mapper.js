function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapCanvasToScreen(input) {
  const {
    x,
    y,
    canvasWidth,
    canvasHeight,
    screenWidth,
    screenHeight
  } = input;

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    !Number.isFinite(screenWidth) ||
    !Number.isFinite(screenHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    screenWidth <= 0 ||
    screenHeight <= 0
  ) {
    return null;
  }

  const ratioX = clamp(x / canvasWidth, 0, 1);
  const ratioY = clamp(y / canvasHeight, 0, 1);

  return {
    x: Math.round(ratioX * (screenWidth - 1)),
    y: Math.round(ratioY * (screenHeight - 1))
  };
}

function normalizeRegion(region, screen) {
  if (!region) {
    return null;
  }

  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const screenWidth = Number(screen.width);
  const screenHeight = Number(screen.height);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) {
    return null;
  }

  const left = clamp(Math.round(x), 0, Math.max(0, screenWidth - 1));
  const top = clamp(Math.round(y), 0, Math.max(0, screenHeight - 1));
  const right = clamp(
    Math.round(x + width),
    left + 1,
    Math.max(left + 1, screenWidth)
  );
  const bottom = clamp(
    Math.round(y + height),
    top + 1,
    Math.max(top + 1, screenHeight)
  );

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function mapCanvasToRegion(input) {
  const mapped = mapCanvasToScreen({
    x: input.x,
    y: input.y,
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    screenWidth: input.region.width,
    screenHeight: input.region.height
  });

  if (!mapped) {
    return null;
  }

  return {
    x: input.region.x + mapped.x,
    y: input.region.y + mapped.y
  };
}

module.exports = {
  clamp,
  mapCanvasToScreen,
  normalizeRegion,
  mapCanvasToRegion
};
