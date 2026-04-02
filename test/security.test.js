const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeToken,
  generatePairToken,
  buildDrawUrl,
  isLoopbackAddress
} = require("../src/security");

test("sanitizeToken trims token strings", () => {
  assert.equal(sanitizeToken("  abc123  "), "abc123");
  assert.equal(sanitizeToken(null), "");
});

test("generatePairToken returns hex string with expected length", () => {
  const token = generatePairToken(10);
  assert.equal(token.length, 10);
  assert.match(token, /^[0-9a-f]+$/);
});

test("buildDrawUrl appends token when required", () => {
  assert.equal(
    buildDrawUrl("192.168.1.9", 8090, "abc", true),
    "http://192.168.1.9:8090/?token=abc"
  );
  assert.equal(buildDrawUrl("192.168.1.9", 8090, "", true), "http://192.168.1.9:8090");
});

test("isLoopbackAddress recognizes loopback patterns", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.50.224"), false);
});
