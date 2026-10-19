const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/sky.js");

const FRAME_W = 1920;
const ORION = { ra: 83.8, dec: 0, fov: 60, rotation: 0, projection: 0 };

// Seeded PRNG so any failure reproduces exactly.
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("angularDistance returns degrees on the sphere", () => {
  assert.ok(Math.abs(S.angularDistance(0, 0, 90, 0) - 90) < 1e-9);
  assert.ok(Math.abs(S.angularDistance(10, 0, 10, 90) - 90) < 1e-9);
  assert.ok(Math.abs(S.angularDistance(359, 0, 1, 0) - 2) < 1e-9);
  assert.ok(Math.abs(S.angularDistance(0, 90, 123, 90)) < 1e-9);
});

test("wrapRa maps into [0,360)", () => {
  assert.equal(S.wrapRa(-10), 350);
  assert.equal(S.wrapRa(370), 10);
  assert.equal(S.wrapRa(360), 0);
  assert.equal(S.wrapRa(0), 0);
  const w = S.wrapRa(-1e-15);
  assert.ok(w >= 0 && w < 360);
});

test("nearestRa picks the copy closest to ref", () => {
  assert.equal(S.nearestRa(1, 359), 361);
  assert.equal(S.nearestRa(359, 1), -1);
  assert.equal(S.nearestRa(10, 10), 10);
});

test("mid is a wrap-safe spherical mean", () => {
  const m = S.mid([[359, 0], [1, 0]]);
  assert.ok(Math.abs(m[0]) < 1e-9 || Math.abs(m[0] - 360) < 1e-9);
  assert.ok(Math.abs(m[1]) < 1e-9);
  const n = S.mid([[10, 20], [10, 20]]);
  assert.ok(Math.abs(n[0] - 10) < 1e-9);
  assert.ok(Math.abs(n[1] - 20) < 1e-9);
});

test("Orion: Betelgeuse is up and left, Rigel is down and right", () => {
  const project = S.makeProjector(ORION, FRAME_W);
  const bet = [0, 0], rig = [0, 0];
  assert.equal(project(88.79, 7.41, bet), true);
  assert.equal(project(78.63, -8.20, rig), true);
  assert.ok(bet[0] < 0 && bet[1] > 0, "Betelgeuse at " + bet);
  assert.ok(rig[0] > 0 && rig[1] < 0, "Rigel at " + rig);
});

test("a point on the horizontal edge lands at x = 960", () => {
  const project = S.makeProjector(ORION, FRAME_W);
  const p = [0, 0];
  assert.equal(project(83.8 - 30, 0, p), true);
  assert.ok(Math.abs(p[0] - 960) <= 0.5, "x was " + p[0]);
  assert.ok(Math.abs(p[1]) < 1e-9);
});

test("the camera centre projects to (0,0)", () => {
  const project = S.makeProjector(ORION, FRAME_W);
  const p = [5, 5];
  project(83.8, 0, p);
  assert.ok(Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9);
});

test("rotation turns the frame counter-clockwise", () => {
  const base = [0, 0], turned = [0, 0];
  S.makeProjector(ORION, FRAME_W)(88.79, 7.41, base);
  S.makeProjector(Object.assign({}, ORION, { rotation: 90 }), FRAME_W)(88.79, 7.41, turned);
  assert.ok(Math.abs(turned[0] + base[1]) < 1e-6, "x " + turned[0] + " vs " + (-base[1]));
  assert.ok(Math.abs(turned[1] - base[0]) < 1e-6, "y " + turned[1] + " vs " + base[0]);
});

test("pixelsPerDegree matches the projector near the centre", () => {
  const ppd = S.pixelsPerDegree(ORION, FRAME_W);
  assert.ok(Math.abs(ppd - (960 / (2 * Math.tan(15 * Math.PI / 180))) * Math.PI / 180) < 1e-9);
  const p = [0, 0];
  S.makeProjector(ORION, FRAME_W)(83.8, 0.001, p);
  assert.ok(Math.abs(p[1] / 0.001 - ppd) / ppd < 1e-4, "y " + p[1]);
});

test("unproject round-trips 200 visible points within 1e-6 degrees", () => {
  const cams = [ORION, { ra: 200, dec: -30, fov: 90, rotation: 37, projection: 0 }];
  const r = rng(42);
  for (const cam of cams) {
    const project = S.makeProjector(cam, FRAME_W);
    for (let i = 0; i < 200; i++) {
      const ra = S.wrapRa(cam.ra + (r() - 0.5) * 100);
      const dec = Math.max(-89, Math.min(89, cam.dec + (r() - 0.5) * 100));
      const p = [0, 0];
      assert.equal(project(ra, dec, p), true);
      const back = S.unproject(cam, FRAME_W, p[0], p[1]);
      assert.ok(S.angularDistance(ra, dec, back[0], back[1]) < 1e-6, "point " + i + " back to " + back);
    }
  }
});

test("the projector returns finite numbers for every RA with the camera at dec 90 and 0", () => {
  for (const camDec of [90, 0]) {
    const cam = { ra: 0, dec: camDec, fov: 60, rotation: 0, projection: 0 };
    const project = S.makeProjector(cam, FRAME_W);
    for (let ra = 0; ra < 360; ra++) {
      const p = [0, 0];
      project(ra, 30, p);
      assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), "dec " + camDec + " ra " + ra);
    }
  }
});

test("a point more than 120 degrees away returns false and is clamped to the 120 degree circle", () => {
  const cam = { ra: 0, dec: 0, fov: 180, rotation: 0, projection: 0 };
  const p = [0, 0];
  assert.equal(S.makeProjector(cam, FRAME_W)(150, 0, p), false);
  const scale = (FRAME_W / 2) / (2 * Math.tan(Math.PI / 4));
  assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 2 * Math.sqrt(3) * scale) < 1e-6);
  assert.ok(p[0] < 0 && Math.abs(p[1]) < 1e-9, "clamped point " + p);
});

test("unsupported projections are rejected", () => {
  assert.throws(() => S.makeProjector({ ra: 0, dec: 0, fov: 60, projection: 1 }, FRAME_W));
});
