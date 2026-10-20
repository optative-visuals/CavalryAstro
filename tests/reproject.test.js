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

// ---- Quantised view (aliasing fix): scale in 1/8-octave steps, whole-pixel offsets, 16-tap footprint. ----

const FOV_CAMS = [
  { ra: 84, dec: 0, fov: 30, rotation: 0, projection: 0 },
  { ra: 84, dec: 0, fov: 62.5, rotation: 0, projection: 0 },
  { ra: 84, dec: 0, fov: 63, rotation: 0, projection: 0 },
  { ra: 84, dec: 0, fov: 100, rotation: 0, projection: 0 },
  { ra: 84, dec: 0, fov: 180, rotation: 0, projection: 0 },
  { ra: 40, dec: 90, fov: 60, rotation: 0, projection: 0 },
  { ra: 40, dec: -90, fov: 45, rotation: 0, projection: 0 },
  { ra: 0.3, dec: 20, fov: 40, rotation: 0, projection: 0 },
  { ra: 359.8, dec: -10, fov: 50, rotation: 30, projection: 0 },
];

test("viewFor's scale is a 1/8-octave power of two, at most the raw scale", () => {
  for (const cam of FOV_CAMS) {
    const view = R.viewFor(cam, W, H);
    const steps = 8 * Math.log(view.scale) / Math.LN2;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, "1/8-octave step for fov " + cam.fov + " " + steps);
    assert.ok(view.scale <= view.rawScale * (1 + 1e-12), "scale <= raw for fov " + cam.fov);
    assert.ok(view.scale * Math.pow(2, 1 / 8) > view.rawScale * (1 - 1e-12), "within one step of raw for fov " + cam.fov);
  }
});

test("viewFor's position is whole source pixels, and offset is derived from it", () => {
  for (const cam of FOV_CAMS) {
    const view = R.viewFor(cam, W, H);
    assert.ok(Number.isInteger(view.position[0]), "position x for fov " + cam.fov);
    assert.ok(Number.isInteger(view.position[1]), "position y for fov " + cam.fov);
    assert.ok(Math.abs(view.offset[0] - (view.position[0] + 2052 + view.scale * cam.ra)) < 1e-9, "offset x for fov " + cam.fov);
    assert.ok(Math.abs(view.offset[1] - (view.position[1] + 2052)) < 1e-9, "offset y for fov " + cam.fov);
  }
});

test("the quantised box stays inside the source comp, sampled densely over the frame", () => {
  for (const cam of FOV_CAMS) {
    const view = R.viewFor(cam, W, H);
    for (let gy = 0; gy <= 36; gy++) {
      for (let gx = 0; gx <= 64; gx++) {
        const x = -W / 2 + (gx * W) / 64;
        const y = -H / 2 + (gy * H) / 36;
        const s = R.sourcePoint(cam, W, view, x, y);
        if (!s) continue;
        assert.ok(s[0] >= 0 && s[0] <= SOURCE, "sx in comp, fov " + cam.fov + " ra " + cam.ra);
        assert.ok(s[1] >= 0 && s[1] <= SOURCE, "sy in comp, fov " + cam.fov + " dec " + cam.dec);
      }
    }
  }
});

test("cameras 0.01 deg apart in RA at the same fov share the quantised scale, offsets whole pixels apart", () => {
  const a = R.viewFor({ ra: 84, dec: 0, fov: 62.5, rotation: 0, projection: 0 }, W, H);
  const b = R.viewFor({ ra: 84.01, dec: 0, fov: 62.5, rotation: 0, projection: 0 }, W, H);
  assert.equal(a.scale, b.scale, "same scale");
  assert.equal(a.offset[1], b.offset[1], "same Dec offset");
  const dPos = b.position[0] - a.position[0];
  assert.ok(Number.isInteger(dPos), "position steps in whole pixels: " + dPos);
  assert.ok(Math.abs((b.offset[0] - a.offset[0]) - (dPos + a.scale * 0.01)) < 1e-6, "offset follows the RA shift");
});

test("footprintTaps returns 16 points centred on sourcePoint, within half the pixel footprint", () => {
  const view = R.viewFor(ORION, W, H);
  for (const name of Object.keys(STARS)) {
    const [ra, dec] = STARS[name];
    const x = pixelOf(ORION, ra, dec)[0], y = pixelOf(ORION, ra, dec)[1];
    const s0 = R.sourcePoint(ORION, W, view, x, y);
    const taps = R.footprintTaps(ORION, W, view, x, y);
    assert.equal(taps.length, 16, name + " has 16 taps");
    let mx = 0, my = 0;
    for (const t of taps) { mx += t[0] / 16; my += t[1] / 16; }
    assert.ok(Math.abs(mx - s0[0]) < 0.01 && Math.abs(my - s0[1]) < 0.01, name + " centred");
    const ex = R.sourcePoint(ORION, W, view, x + 1, y);
    const ey = R.sourcePoint(ORION, W, view, x, y + 1);
    const fx = Math.abs(ex[0] - s0[0]) + Math.abs(ey[0] - s0[0]);
    const fy = Math.abs(ex[1] - s0[1]) + Math.abs(ey[1] - s0[1]);
    for (const t of taps) {
      assert.ok(Math.abs(t[0] - s0[0]) <= fx / 2 + 1e-9, name + " x within footprint");
      assert.ok(Math.abs(t[1] - s0[1]) <= fy / 2 + 1e-9, name + " y within footprint");
    }
    const spread = Math.max(...taps.map((t) => t[0])) - Math.min(...taps.map((t) => t[0]));
    assert.ok(spread > 0.5 * fx, name + " spreads over the footprint");
  }
});

test("footprintTaps falls back to the single source point beyond the projector's 120 degrees", () => {
  const cam = { ra: 84, dec: 0, fov: 180, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  // The pixel just inside the 120 degree circle: its right neighbour lies beyond it.
  const pxPerRad = S.pixelsPerDegree(cam, W) / (Math.PI / 180);
  const x = 2 * Math.tan(60 * Math.PI / 180) * pxPerRad - 0.5;
  const taps = R.footprintTaps(cam, W, view, x, 0);
  assert.equal(taps.length, 1);
  assert.equal(R.footprintTaps(cam, W, view, 3000, 0), null);
});

test("at camera Dec 7.3 the View position puts Betelgeuse and its tile where the filter samples them, within 1e-6", () => {
  const cam = { ra: 84, dec: 7.3, fov: 62.5, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  const [ra, dec] = STARS.Betelgeuse;
  const p = R.sourcePoint(cam, W, view, ...pixelOf(cam, ra, dec));
  // The View group: a sky point at its degrees sits at degrees × scale + position; the filter adds the 2052 centre.
  assert.ok(Math.abs((p[0] - 2052) - (view.position[0] + ra * view.scale)) < 1e-6, "star x");
  assert.ok(Math.abs((p[1] - 2052) - (view.position[1] + dec * view.scale)) < 1e-6, "star y");
  const tile = I.tileOf(3, ra, dec);
  const box = I.tileBox(3, tile.row, tile.col);
  const t = R.tileLocal(3, tile.row, tile.col, view, cam);
  const midRa = (box.ra0 + box.ra1) / 2, midDec = (box.dec0 + box.dec1) / 2;
  assert.ok(Math.abs((t.x - 2052) - (view.position[0] + midRa * view.scale)) < 1e-6, "tile x");
  assert.ok(Math.abs((t.y - 2052) - (view.position[1] + midDec * view.scale)) < 1e-6, "tile y");
});
