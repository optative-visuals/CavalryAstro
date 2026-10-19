const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/core/util.js");

test("hash is deterministic, 16 hex chars, and differs for different input", () => {
  assert.match(U.hash("abc"), /^[0-9a-f]{16}$/);
  assert.equal(U.hash("abc"), U.hash("abc"));
  assert.notEqual(U.hash("abc"), U.hash("abd"));
});

test("formatBytes", () => {
  assert.equal(U.formatBytes(12345), "12 KB");
  assert.equal(U.formatBytes(5400000), "5.4 MB");
});

test("formatBytes rolls over to MB instead of showing 1000 KB", () => {
  assert.equal(U.formatBytes(999999), "1.0 MB");
  assert.equal(U.formatBytes(999499), "999 KB");
});
