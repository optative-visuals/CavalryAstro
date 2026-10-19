const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/sky.js");
const I = require("../src/core/imagery.js");
const R = require("../src/core/reproject.js");

const W = 1920, H = 1080, SOURCE = 4104;
const ORION = { ra: 84, dec: 0, fov: 62.5, rotation: 0, projection: 0 };
const STARS = {
  Betelgeuse: [88.79, 7.41],
  Rigel: [78.63, -8.20],
  Sirius: [101.29, -16.72]
};

// Seeded PRNG so any failure reproduces exactly.
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The Cavalry pixel of a sky point for a camera.
function pixelOf(cam, ra, dec) {
  const out = [0, 0];
  S.makeProjector(cam, W)(ra, dec, out);
  return out;
}

test("SOURCE_PX is the square source comp, 4104 px", () => {
  assert.equal(R.SOURCE_PX, SOURCE);
});

test("sourcePoint of each star matches the linear RA/Dec mapping within 0.01 source px", () => {
  const view = R.viewFor(ORION, W, H);
  for (const name of Object.keys(STARS)) {
    const [ra, dec] = STARS[name];
    const p = R.sourcePoint(ORION, W, view, ...pixelOf(ORION, ra, dec));
    assert.ok(p, name + " inside the projector");
    assert.ok(Math.abs(p[0] - ((ra - ORION.ra) * view.scale + view.offset[0])) < 0.01, name + " sx");
    assert.ok(Math.abs(p[1] - (dec * view.scale + view.offset[1])) < 0.01, name + " sy");
  }
});

test("a star's source point maps back to its RA/Dec within 0.01 degrees", () => {
  const view = R.viewFor(ORION, W, H);
  for (const name of Object.keys(STARS)) {
    const [ra, dec] = STARS[name];
    const p = R.sourcePoint(ORION, W, view, ...pixelOf(ORION, ra, dec));
    const backRa = (p[0] - view.offset[0]) / view.scale + ORION.ra;
    const backDec = (p[1] - view.offset[1]) / view.scale;
    assert.ok(Math.abs(backRa - ra) < 0.01, name + " ra " + backRa);
    assert.ok(Math.abs(backDec - dec) < 0.01, name + " dec " + backDec);
  }
});

test("across the RA 0/360 seam the source is continuous (RA 359.9 and RA 0.1 are 0.2 deg apart)", () => {
  const cam = { ra: 359, dec: 0, fov: 20, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  const a = R.sourcePoint(cam, W, view, ...pixelOf(cam, 359.9, 0));
  const b = R.sourcePoint(cam, W, view, ...pixelOf(cam, 0.1, 0));
  assert.ok(Math.abs((b[0] - a[0]) - 0.2 * view.scale) < 0.01, "step of 0.2 deg");
});

test("a camera at RA 359 maps a pixel showing RA 1 to about 2 deg right of centre", () => {
  const cam = { ra: 359, dec: 0, fov: 20, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  const p = R.sourcePoint(cam, W, view, ...pixelOf(cam, 1, 0));
  assert.ok(p[0] > view.offset[0], "to the right of centre");
  assert.ok(Math.abs((p[0] - view.offset[0]) - 2 * view.scale) < 0.01);
});

test("sourcePoint is finite across the whole frame with the camera at the north and south poles", () => {
  for (const dec of [90, -90]) {
    for (const fov of [30, 60]) {
      const cam = { ra: 0, dec: dec, fov: fov, rotation: 0, projection: 0 };
      const view = R.viewFor(cam, W, H);
      for (const p of I.frameGrid(W, H)) {
        const s = R.sourcePoint(cam, W, view, p[0], p[1]);
        assert.ok(s, "non-null at dec " + dec + " fov " + fov);
        assert.ok(Number.isFinite(s[0]) && Number.isFinite(s[1]), "finite at dec " + dec);
      }
    }
  }
});

test("viewFor boxes fit inside SOURCE_PX for fov 5 to 180, including random cameras", () => {
  const cams = [];
  for (const fov of [5, 10, 20, 45, 90, 120, 150, 180]) {
    cams.push({ ra: 83.8, dec: -5.4, fov: fov, rotation: 0, projection: 0 });
  }
  const rnd = rng(20261019);
  for (let i = 0; i < 50; i++) {
    cams.push({
      ra: rnd() * 360,
      dec: Math.asin(2 * rnd() - 1) * 180 / Math.PI,
      fov: 5 + rnd() * 175,
      rotation: rnd() * 360,
      projection: 0
    });
  }
  for (const cam of cams) {
    const view = R.viewFor(cam, W, H);
    assert.ok(view.scale > 0 && Number.isFinite(view.scale), "scale");
    let inside = 0;
    for (const p of I.frameGrid(W, H)) {
      const s = R.sourcePoint(cam, W, view, p[0], p[1]);
      if (!s) continue;
      inside++;
      assert.ok(s[0] >= 0 && s[0] <= SOURCE, "sx in comp for fov " + cam.fov + " " + s[0]);
      assert.ok(s[1] >= 0 && s[1] <= SOURCE, "sy in comp for fov " + cam.fov + " " + s[1]);
    }
    assert.ok(inside > 0, "some frame points are inside the projector for fov " + cam.fov);
  }
});

test("sourcePoint returns null beyond the projector's 120 degrees", () => {
  const cam = { ra: 84, dec: 0, fov: 180, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  assert.equal(R.sourcePoint(cam, W, view, 3000, 0), null);
  assert.ok(R.sourcePoint(cam, W, view, 0, 0));
});

test("tileLocal places the tile holding Betelgeuse so the star's source point falls inside it", () => {
  const view = R.viewFor(ORION, W, H);
  const [ra, dec] = STARS.Betelgeuse;
  const p = R.sourcePoint(ORION, W, view, ...pixelOf(ORION, ra, dec));
  const tile = I.tileOf(3, ra, dec);
  const t = R.tileLocal(3, tile.row, tile.col, view, ORION);
  const half = t.scale * I.TILE / 2;
  assert.ok(Math.abs(p[0] - t.x) <= half, "x inside tile");
  assert.ok(Math.abs(p[1] - t.y) <= half, "y inside tile");
  const box = I.tileBox(3, tile.row, tile.col);
  assert.ok(Math.abs(t.scale * I.TILE - (box.ra1 - box.ra0) * view.scale) < 1e-9, "tile size in source px");
});
