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

test("footprintTaps returns 25 weighted taps centred on sourcePoint, with weights that sum to 1", () => {
  const view = R.viewFor(ORION, W, H);
  for (const name of Object.keys(STARS)) {
    const [ra, dec] = STARS[name];
    const [x, y] = pixelOf(ORION, ra, dec);
    const s0 = R.sourcePoint(ORION, W, view, x, y);
    const taps = R.footprintTaps(ORION, W, view, x, y, 1);
    assert.equal(taps.length, 25, name + " has 25 taps");
    const wsum = taps.reduce((a, t) => a + t.w, 0);
    assert.ok(Math.abs(wsum - 1) < 1e-12, name + " weights sum to 1");
    let mx = 0, my = 0;
    for (const t of taps) { mx += t.p[0] * t.w; my += t.p[1] * t.w; }
    assert.ok(Math.abs(mx - s0[0]) < 1e-6 && Math.abs(my - s0[1]) < 1e-6, name + " centred on sourcePoint");
  }
});

test("footprintTaps weights are the 5×5 Gaussian, symmetric about the centre", () => {
  const view = R.viewFor(ORION, W, H);
  const [ra, dec] = STARS.Betelgeuse;
  const [x, y] = pixelOf(ORION, ra, dec);
  const softness = 1.5;
  const taps = R.footprintTaps(ORION, W, view, x, y, softness);
  const s0 = R.sourcePoint(ORION, W, view, x, y);
  const ex = R.sourcePoint(ORION, W, view, x + 1, y), ey = R.sourcePoint(ORION, W, view, x, y + 1);
  const dx = [ex[0] - s0[0], ex[1] - s0[1]], dy = [ey[0] - s0[0], ey[1] - s0[1]];
  // Each tap's offset in output pixels, recovered from its position (the footprint vectors are linear).
  const offsets = taps.map((t) => {
    const px = t.p[0] - s0[0], py = t.p[1] - s0[1];
    const det = dx[0] * dy[1] - dy[0] * dx[1];
    return [(px * dy[1] - dy[0] * py) / det, (dx[0] * py - px * dx[1]) / det];
  });
  const sigma = 0.5 * softness;
  const raw = offsets.map(([u, v]) => Math.exp(-(u * u + v * v) / (2 * sigma * sigma)));
  const total = raw.reduce((a, b) => a + b, 0);
  taps.forEach((t, k) => {
    assert.ok(Math.abs(t.w - raw[k] / total) < 1e-9, "weight " + k);
  });
  // Mirror pairs: the tap at (u, v) and the one at (-u, -v) carry the same weight.
  const byKey = new Map(offsets.map((o, k) => [o[0].toFixed(6) + "," + o[1].toFixed(6), taps[k].w]));
  for (const [u, v] of offsets) {
    const mirror = byKey.get((-u).toFixed(6) + "," + (-v).toFixed(6));
    assert.ok(mirror !== undefined && Math.abs(mirror - byKey.get(u.toFixed(6) + "," + v.toFixed(6))) < 1e-12, "mirror pair");
  }
});

test("footprintTaps at softness 0 is a single tap at sourcePoint", () => {
  const view = R.viewFor(ORION, W, H);
  const [ra, dec] = STARS.Rigel;
  const [x, y] = pixelOf(ORION, ra, dec);
  const s0 = R.sourcePoint(ORION, W, view, x, y);
  const taps = R.footprintTaps(ORION, W, view, x, y, 0);
  assert.equal(taps.length, 1);
  assert.equal(taps[0].w, 1);
  assert.deepEqual(taps[0].p, s0);
});

test("footprintTaps spread is proportional to softness", () => {
  const view = R.viewFor(ORION, W, H);
  const [ra, dec] = STARS.Sirius;
  const [x, y] = pixelOf(ORION, ra, dec);
  const spread = (softness) => {
    const xs = R.footprintTaps(ORION, W, view, x, y, softness).map((t) => t.p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const one = spread(1);
  assert.ok(one > 0, "spreads at softness 1");
  assert.ok(Math.abs(spread(2) / one - 2) < 1e-9, "twice the softness, twice the spread");
  assert.ok(Math.abs(spread(0.5) / one - 0.5) < 1e-9, "half the softness, half the spread");
});

test("footprintTaps falls back to the single source point beyond the projector's 120 degrees", () => {
  // Dec 30 keeps this boundary pixel inside the source comp, so the fallback is the one tap, not none.
  const cam = { ra: 84, dec: 30, fov: 180, rotation: 0, projection: 0 };
  const view = R.viewFor(cam, W, H);
  // The pixel just inside the 120 degree circle: its right neighbour lies beyond it.
  const pxPerRad = S.pixelsPerDegree(cam, W) / (Math.PI / 180);
  const x = 2 * Math.tan(60 * Math.PI / 180) * pxPerRad - 0.5;
  const taps = R.footprintTaps(cam, W, view, x, 0, 1);
  assert.equal(taps.length, 1);
  assert.equal(taps[0].w, 1);
  assert.deepEqual(taps[0].p, R.sourcePoint(cam, W, view, x, 0));
  assert.equal(R.footprintTaps(cam, W, view, 3000, 0, 1), null);
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
