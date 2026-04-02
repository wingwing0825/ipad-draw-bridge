const crypto = require("node:crypto");

function sanitizeToken(token) {
  if (typeof token !== "string") {
    return "";
  }

  return token.trim();
}

function generatePairToken(length = 12) {
  const size = Math.max(4, Math.floor(length));
  const bytes = crypto.randomBytes(Math.ceil(size / 2));
  return bytes.toString("hex").slice(0, size);
}

function buildDrawUrl(ip, port, token, requireToken) {
  const safeToken = sanitizeToken(token);
  if (!requireToken || !safeToken) {
    return `http://${ip}:${port}`;
  }
  return `http://${ip}:${port}/?token=${encodeURIComponent(safeToken)}`;
}

function isLoopbackAddress(address) {
  if (typeof address !== "string") {
    return false;
  }

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

module.exports = {
  sanitizeToken,
  generatePairToken,
  buildDrawUrl,
  isLoopbackAddress
};
