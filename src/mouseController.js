const isWindows = process.platform === "win32";

let state = {
  available: false,
  leftDown: false,
  setCursorPos: null,
  mouseEvent: null,
  sendInput: null,
  getSystemMetrics: null,
  pointerSize: 0,
  inputSize: 0,
  mouseInputOffset: 0
};

const INPUT_MOUSE = 0;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

function setupMouseController() {
  if (!isWindows) {
    return {
      available: false,
      reason: "Only supported on Windows."
    };
  }

  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const pointerSize = Number(koffi.sizeof("void *")) || 8;
    const inputSize = pointerSize === 8 ? 40 : 28;
    const mouseInputOffset = pointerSize === 8 ? 8 : 4;

    state = {
      ...state,
      available: true,
      setCursorPos: user32.func("bool SetCursorPos(int X, int Y)"),
      mouseEvent: user32.func(
        "void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr_t dwExtraInfo)"
      ),
      sendInput: user32.func("uint SendInput(uint cInputs, void* pInputs, int cbSize)"),
      getSystemMetrics: user32.func("int GetSystemMetrics(int nIndex)"),
      pointerSize,
      inputSize,
      mouseInputOffset
    };

    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: `Failed to load Windows mouse API: ${error.message}`
    };
  }
}

function getScreenSize() {
  if (!state.available) {
    return { width: 1920, height: 1080 };
  }

  const width = state.getSystemMetrics(SM_CXSCREEN);
  const height = state.getSystemMetrics(SM_CYSCREEN);
  return { width, height };
}

function moveMouse(x, y) {
  if (!state.available) {
    return false;
  }

  const targetX = Math.round(Number(x) || 0);
  const targetY = Math.round(Number(y) || 0);

  if (sendMouseMoveEvent(targetX, targetY)) {
    return true;
  }

  if (typeof state.setCursorPos === "function") {
    state.setCursorPos(targetX, targetY);
    return true;
  }

  return false;
}

function mouseDown() {
  if (!state.available || state.leftDown) {
    return false;
  }

  const sent = sendMouseButtonEvent(MOUSEEVENTF_LEFTDOWN);
  if (!sent) {
    state = { ...state, leftDown: false };
    return false;
  }

  state = { ...state, leftDown: true };
  return true;
}

function mouseUp() {
  if (!state.available || !state.leftDown) {
    return false;
  }

  sendMouseButtonEvent(MOUSEEVENTF_LEFTUP);
  state = { ...state, leftDown: false };
  return true;
}

function forceMouseDown() {
  if (!state.available) {
    return false;
  }
  const sent = sendMouseButtonEvent(MOUSEEVENTF_LEFTDOWN);
  if (sent) {
    state = { ...state, leftDown: true };
  }
  return sent;
}

function forceMouseUp() {
  if (!state.available) {
    return false;
  }
  const sent = sendMouseButtonEvent(MOUSEEVENTF_LEFTUP);
  state = { ...state, leftDown: false };
  return sent;
}

function ensureMouseReleased() {
  if (state.leftDown) {
    forceMouseUp();
  }
}

function sendMouseButtonEvent(flags) {
  if (!state.available) {
    return false;
  }

  let sent = false;

  if (typeof state.sendInput === "function" && Number.isFinite(state.inputSize) && state.inputSize > 0) {
    const buffer = buildMouseInputBuffer({
      flags
    });
    const sendInputResult = Number(state.sendInput(1, buffer, state.inputSize)) || 0;
    if (sendInputResult >= 1) {
      sent = true;
    }
  }

  if (typeof state.mouseEvent === "function") {
    // Keep legacy path active as a reliability fallback for some desktop apps.
    state.mouseEvent(flags, 0, 0, 0, 0);
    sent = true;
  }

  return sent;
}

function sendMouseMoveEvent(x, y) {
  if (!state.available) {
    return false;
  }

  const { width, height } = getScreenSize();
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const maxX = Math.max(1, safeWidth - 1);
  const maxY = Math.max(1, safeHeight - 1);
  const clampedX = clamp(Math.round(Number(x) || 0), 0, maxX);
  const clampedY = clamp(Math.round(Number(y) || 0), 0, maxY);
  const normalizedX = clamp(Math.round((clampedX * 65535) / maxX), 0, 65535);
  const normalizedY = clamp(Math.round((clampedY * 65535) / maxY), 0, 65535);

  let sent = false;

  if (typeof state.sendInput === "function" && Number.isFinite(state.inputSize) && state.inputSize > 0) {
    const buffer = buildMouseInputBuffer({
      dx: normalizedX,
      dy: normalizedY,
      flags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
    });
    const sendInputResult = Number(state.sendInput(1, buffer, state.inputSize)) || 0;
    if (sendInputResult >= 1) {
      sent = true;
    }
  }

  if (!sent && typeof state.mouseEvent === "function") {
    state.mouseEvent(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, normalizedX, normalizedY, 0, 0);
    sent = true;
  }

  return sent;
}

function buildMouseInputBuffer(input) {
  const payload = input || {};
  const dx = Math.trunc(Number(payload.dx) || 0);
  const dy = Math.trunc(Number(payload.dy) || 0);
  const mouseData = Math.trunc(Number(payload.mouseData) || 0);
  const flags = Math.trunc(Number(payload.flags) || 0);
  const time = Math.trunc(Number(payload.time) || 0);
  const inputSize = Number(state.inputSize) || 40;
  const pointerSize = Number(state.pointerSize) || 8;
  const miOffset = Number(state.mouseInputOffset) || (pointerSize === 8 ? 8 : 4);
  const extraInfoOffset = miOffset + 20;
  const buffer = Buffer.alloc(inputSize);

  // INPUT.type = INPUT_MOUSE (0)
  buffer.writeUInt32LE(INPUT_MOUSE, 0);
  // MOUSEINPUT.dx / dy
  buffer.writeInt32LE(dx, miOffset + 0);
  buffer.writeInt32LE(dy, miOffset + 4);
  // MOUSEINPUT.mouseData
  buffer.writeUInt32LE(mouseData >>> 0, miOffset + 8);
  // MOUSEINPUT.dwFlags
  buffer.writeUInt32LE(flags >>> 0, miOffset + 12);
  // MOUSEINPUT.time
  buffer.writeUInt32LE(time >>> 0, miOffset + 16);

  if (pointerSize === 8) {
    buffer.writeBigUInt64LE(0n, extraInfoOffset);
  } else {
    buffer.writeUInt32LE(0, extraInfoOffset);
  }

  return buffer;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  setupMouseController,
  getScreenSize,
  moveMouse,
  mouseDown,
  mouseUp,
  forceMouseDown,
  forceMouseUp,
  ensureMouseReleased
};
