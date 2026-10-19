const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/core/render.js");
const S = require("../src/core/sky.js");

class FakePath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(["M", x, y]); }
  lineTo(x, y) { this.ops.push(["L", x, y]); }
  close() { this.ops.push(["Z"]); }
  addEllipse(x, y, rx, ry) { this.ops.push(["E", x, y, rx, ry]); }
  addText(t, size, x, y) { this.ops.push(["T", t, size, x, y]); }
}
const W = 1920;
const ops = (p, k) => p.ops.filter((o) => o[0] === k);
const ORION_VIEW = { ra: 83.8, dec: -5.4, fov: 180, rotation: 0, projection: 0 };
const VIEW60 = { ra: 85, dec: 0, fov: 60, rotation: 0, projection: 0 };
// Stars around Orion, magnitudes from bright to faint: 3 are brighter than limit 3, all 6 are inside limit 7.
const ORION_STARS = {
  ra: [83.8, 85.2, 81.3, 88.8, 84.0, 86.0],
  dec: [-5.4, -1.2, -8.2, 7.4, -1.2, -9.7],
  mag: [0.5, 1.7, 2.8, 3.5, 5.5, 6.5]
};

test("stars: darkness 100 draws more stars than darkness 0 on a 180 degree Orion view", () => {
  const dark = R.stars(ORION_STARS, ORION_VIEW, W, { darkness: 0 }, FakePath);
  const country = R.stars(ORION_STARS, ORION_VIEW, W, { darkness: 100 }, FakePath);
  assert.equal(ops(dark, "E").length, 3);
  assert.equal(ops(country, "E").length, 6);
  assert.ok(ops(country, "E").length > ops(dark, "E").length);
});

test("stars: ignoreLimit draws a magnitude 6.5 star at darkness 0", () => {
  const faint = { ra: [83.8], dec: [-5.4], mag: [6.5] };
  assert.equal(ops(R.stars(faint, ORION_VIEW, W, { darkness: 0 }, FakePath), "E").length, 0);
  assert.equal(ops(R.stars(faint, ORION_VIEW, W, { darkness: 0, ignoreLimit: true }, FakePath), "E").length, 1);
});

test("stars: hidden stars (behind the camera) are not drawn", () => {
  const behind = { ra: [263.8], dec: [-5.4], mag: [0] }; // 180 degrees from the view centre
  assert.equal(ops(R.stars(behind, VIEW60, W, { darkness: 100 }, FakePath), "E").length, 0);
});

test("lines: draw 0 draws nothing and draw 1 draws every segment", () => {
  const lines = { lines: [[[80, 0], [81, 0], [82, 0]], [[90, 0], [91, 0]]] };
  assert.equal(R.lines(lines, VIEW60, W, { draw: 0 }, FakePath).ops.length, 0);
  const all = R.lines(lines, VIEW60, W, { draw: 1 }, FakePath);
  assert.deepEqual(all.ops.map((o) => o[0]), ["M", "L", "L", "M", "L"]);
});

test("lines: draw 0.5 over two equal segments draws exactly the first", () => {
  const data = { lines: [[[80, 0], [90, 0], [100, 0]]] };
  const p = R.lines(data, VIEW60, W, { draw: 0.5 }, FakePath);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L"]);
  const f = S.makeProjector(VIEW60, W), at90 = [0, 0];
  f(90, 0, at90);
  assert.ok(Math.abs(p.ops[1][1] - at90[0]) < 1e-6 && Math.abs(p.ops[1][2] - at90[1]) < 1e-6);
});

test("lines: a partial last segment ends part of the way along the arc", () => {
  const data = { lines: [[[80, 0], [90, 0]]] };
  const p = R.lines(data, VIEW60, W, { draw: 0.5 }, FakePath);
  const f = S.makeProjector(VIEW60, W), mid = [0, 0], end = [0, 0];
  f(85, 0, mid);
  f(90, 0, end);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L"]);
  assert.ok(Math.abs(p.ops[1][1] - mid[0]) < 0.5 && Math.abs(p.ops[1][2] - mid[1]) < 0.5);
  assert.ok(Math.abs(p.ops[1][1] - end[0]) > 1);
});

test("lines: a line from ra 359 to ra 1 spans less than 100 px at fov 60, camera ra 0", () => {
  const cam = { ra: 0, dec: 0, fov: 60, rotation: 0, projection: 0 };
  const p = R.lines({ lines: [[[359, 0], [1, 0]]] }, cam, W, { draw: 1 }, FakePath);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L"]);
  const len = Math.hypot(p.ops[1][1] - p.ops[0][1], p.ops[1][2] - p.ops[0][2]);
  assert.ok(len > 0 && len < 100, "length " + len);
});

test("border: draws a fully visible ring closed, back to its first point", () => {
  const data = { rings: [[[80, 0], [90, 0], [90, 10], [80, 10]]] };
  const p = R.border(data, VIEW60, W, {}, FakePath);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L", "L", "L", "L"]);
  assert.deepEqual(p.ops[4].slice(1), p.ops[0].slice(1), "the last edge lands back on the first point");
});

test("border: breaks the ring where a point is hidden", () => {
  const cam = { ra: 0, dec: 0, fov: 60, rotation: 0, projection: 0 };
  const data = { rings: [[[0, 0], [5, 0], [180, 0], [0, 5]]] };
  const p = R.border(data, cam, W, {}, FakePath);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L", "M", "L"]);
});

test("border: several rings each draw on their own", () => {
  const ring = (ra) => [[ra, 0], [ra + 2, 0], [ra + 2, 2], [ra, 2]];
  const p = R.border({ rings: [ring(80), ring(88)] }, VIEW60, W, {}, FakePath);
  assert.equal(ops(p, "M").length, 2);
});

test("texts: places the label at the projected centre plus dx, dy", () => {
  const cam = { ra: 83.8, dec: -5.4, fov: 60, rotation: 0, projection: 0 };
  const p = R.texts({ items: [["Orion", 83.8, -5.4]] }, cam, W, { size: 18, dx: 5, dy: -3 }, FakePath);
  assert.equal(p.ops.length, 1);
  const [kind, text, size, x, y] = p.ops[0];
  assert.equal(kind, "T");
  assert.equal(text, "Orion");
  assert.equal(size, 18);
  assert.ok(Math.abs(x - 5) < 1e-9 && Math.abs(y + 3) < 1e-9, "at " + x + "," + y);
});

test("texts: items behind the camera are skipped", () => {
  const p = R.texts({ items: [["Far", 263.8, -5.4]] }, VIEW60, W, { size: 18, dx: 0, dy: 0 }, FakePath);
  assert.equal(p.ops.length, 0);
});

test("a bad camera never throws: projection falls back to 0, fov is clamped", () => {
  const bad = { ra: 83.8, dec: 0, fov: 0, rotation: 0, projection: 2 };
  assert.doesNotThrow(() => R.stars(ORION_STARS, bad, W, { darkness: 100 }, FakePath));
  assert.doesNotThrow(() => R.lines({ lines: [[[80, 0], [90, 0]]] }, { ra: 0, dec: 0, fov: 400, projection: 9 }, W, { draw: 1 }, FakePath));
  assert.doesNotThrow(() => R.border({ rings: [] }, null, W, {}, FakePath));
});
