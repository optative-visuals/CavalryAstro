const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/core/imagery.js");

const FRAME_W = 1920, FRAME_H = 1080;
const ORION = { ra: 83.8, dec: -5.4, fov: 40, rotation: 0, projection: 0 };

// Seeded PRNG so any failure reproduces exactly.
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function has(tiles, row, col) {
  return tiles.some((t) => t.row === row && t.col === col);
}

test("the four levels and their tile grids", () => {
  assert.deepEqual(I.LEVELS.map((l) => [l.L, l.w, l.h, l.cols, l.rows]), [
    [0, 4096, 2048, 4, 2],
    [1, 8192, 4096, 8, 4],
    [2, 16384, 8192, 16, 8],
    [3, 32768, 16384, 32, 16]
  ]);
  assert.equal(I.TILE, 1024);
  assert.equal(I.MAX_TILES, 300);
  assert.equal(I.WARN_TILES, 150);
});

test("tilePath builds the local tile path", () => {
  assert.equal(I.tilePath("C:/x/CavalryAstro_assets", 2, 3, 11),
    "C:/x/CavalryAstro_assets/imagery/nasa-dsm/L2/3_11.jpg");
});

test("pxPerDegree is the level width over 360", () => {
  assert.ok(Math.abs(I.pxPerDegree(0) - 4096 / 360) < 1e-9);
  assert.ok(Math.abs(I.pxPerDegree(3) - 32768 / 360) < 1e-9);
});

test("levelFor picks 0 at fov 180, 1 at fov 100 and 3 at fov 30 for a 1920-wide frame", () => {
  assert.equal(I.levelFor({ ra: 83.8, dec: 0, fov: 180, rotation: 0, projection: 0 }, FRAME_W), 0);
  assert.equal(I.levelFor({ ra: 83.8, dec: 0, fov: 100, rotation: 0, projection: 0 }, FRAME_W), 1);
  assert.equal(I.levelFor({ ra: 83.8, dec: 0, fov: 30, rotation: 0, projection: 0 }, FRAME_W), 3);
});

test("levelFor never goes above level 3", () => {
  assert.equal(I.levelFor({ ra: 0, dec: 0, fov: 1, rotation: 0, projection: 0 }, FRAME_W), 3);
});

test("levelOpacity: L0 is always 100, and a finer level fades in before it is needed", () => {
  const wide = { ra: 83.8, dec: 0, fov: 180, rotation: 0, projection: 0 };
  assert.equal(I.levelOpacity(0, wide, FRAME_W), 100);
  assert.equal(I.levelOpacity(0, { ra: 0, dec: 0, fov: 1, rotation: 0, projection: 0 }, FRAME_W), 100);
  // Far from level 1's threshold: not visible at all.
  assert.equal(I.levelOpacity(1, wide, FRAME_W), 0);
  // Once the frame needs level 1 (ppd above level 0), it is fully opaque.
  assert.equal(I.levelOpacity(1, { ra: 83.8, dec: 0, fov: 60, rotation: 0, projection: 0 }, FRAME_W), 100);
  // Across the fade the opacity rises monotonically from 0 to 100 as the fov narrows.
  let last = -1;
  for (let fov = 120; fov >= 50; fov -= 2) {
    const o = I.levelOpacity(1, { ra: 83.8, dec: 0, fov: fov, rotation: 0, projection: 0 }, FRAME_W);
    assert.ok(o >= 0 && o <= 100, "in range at fov " + fov);
    assert.ok(o >= last, "non-decreasing at fov " + fov);
    last = o;
  }
});

test("tileOf finds the tile holding a point; each tile spans 360/cols by 180/rows", () => {
  assert.deepEqual(I.tileOf(3, 88.79, 7.41), { row: 7, col: 7 });
  assert.deepEqual(I.tileOf(0, 0, 90), { row: 0, col: 0 });
  assert.deepEqual(I.tileOf(0, 359.9, -90), { row: 1, col: 3 });
  const box = I.tileBox(3, 7, 7);
  assert.ok(Math.abs((box.ra1 - box.ra0) - 11.25) < 1e-9);
  assert.ok(Math.abs((box.dec1 - box.dec0) - 11.25) < 1e-9);
  assert.ok(box.ra0 <= 88.79 && 88.79 < box.ra1);
  assert.ok(box.dec0 <= 7.41 && 7.41 < box.dec1);
});

test("visibleTiles across the RA 0/360 seam includes col 31 and col 0 of L3", () => {
  const tiles = I.visibleTiles(3, { ra: 359, dec: 0, fov: 20, rotation: 0, projection: 0 }, FRAME_W, FRAME_H);
  assert.ok(tiles.some((t) => t.col === 31), "col 31 present");
  assert.ok(tiles.some((t) => t.col === 0), "col 0 present");
});

test("visibleTiles at the pole includes every column of row 0 at L1", () => {
  const tiles = I.visibleTiles(1, { ra: 0, dec: 90, fov: 30, rotation: 0, projection: 0 }, FRAME_W, FRAME_H);
  for (let col = 0; col < 8; col++) assert.ok(has(tiles, 0, col), "row 0 col " + col);
});

test("visibleTiles returns no duplicates and only valid tile indices", () => {
  const tiles = I.visibleTiles(3, ORION, FRAME_W, FRAME_H);
  const keys = new Set(tiles.map((t) => t.row + "_" + t.col));
  assert.equal(keys.size, tiles.length);
  for (const t of tiles) {
    assert.ok(t.row >= 0 && t.row < 16 && t.col >= 0 && t.col < 32, JSON.stringify(t));
  }
});

test("planTiles for a fov 100 to fov 30 Orion flight includes all 8 L0 tiles and stays under 300", () => {
  const samples = [];
  for (let fov = 100; fov >= 30; fov -= 5) samples.push({ ra: 83.8, dec: -5.4, fov: fov, rotation: 0, projection: 0 });
  const plan = I.planTiles(samples, FRAME_W, FRAME_H);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    assert.ok(plan.items.some((t) => t.L === 0 && t.row === row && t.col === col), "L0 " + row + "_" + col);
  }
  assert.ok(plan.count < I.MAX_TILES, "count " + plan.count);
  assert.equal(plan.count, plan.items.length);
  assert.equal(plan.capped, null);
});

test("planTiles for 100 random fov 5 cameras is capped and stays under 300", () => {
  const rnd = rng(20261019);
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const ra = rnd() * 360;
    const dec = Math.asin(2 * rnd() - 1) * 180 / Math.PI;
    samples.push({ ra: ra, dec: dec, fov: 5, rotation: 0, projection: 0 });
  }
  const plan = I.planTiles(samples, FRAME_W, FRAME_H);
  assert.notEqual(plan.capped, null);
  assert.ok(plan.count <= I.MAX_TILES, "count " + plan.count);
  assert.ok(plan.items.some((t) => t.L === 0), "L0 kept");
});

// Whether a pole (dec ±90) is inside a frame, as reproject.js decides it.
function poleIn(cam, frameW, frameH, dec) {
  const out = [0, 0];
  const inside = S_PROJ(cam, frameW)(0, dec, out);
  return inside && Math.abs(out[0]) <= frameW / 2 && Math.abs(out[1]) <= frameH / 2;
}
const S_PROJ = (cam, w) => require("../src/core/sky.js").makeProjector(cam, w);

test("the reviewer example (Dec -76.7, fov 39.7) at L3 includes 15_4 to 15_9", () => {
  const cam = { ra: 0, dec: -76.7, fov: 39.7, rotation: 0, projection: 0 };
  const tiles = I.visibleTiles(3, cam, FRAME_W, FRAME_H);
  for (let col = 4; col <= 9; col++) assert.ok(has(tiles, 15, col), "15_" + col);
});

test("a south pole in frame at L3 includes the whole last row", () => {
  const cam = { ra: 0, dec: -89, fov: 40, rotation: 0, projection: 0 };
  assert.ok(poleIn(cam, FRAME_W, FRAME_H, -90), "the pole is in the frame");
  const tiles = I.visibleTiles(3, cam, FRAME_W, FRAME_H);
  for (let col = 0; col < 32; col++) assert.ok(has(tiles, 15, col), "15_" + col);
});

test("visibleTiles covers every tile hit by a dense 121 x 121 sampling, near the poles", () => {
  const cams = [
    { ra: 0, dec: -76.7, fov: 39.7, rotation: 0, projection: 0 },
    { ra: 200, dec: 85, fov: 30, rotation: 0, projection: 0 },
    { ra: 30, dec: 88, fov: 5, rotation: 0, projection: 0 },
    { ra: 120, dec: -80, fov: 65, rotation: 0, projection: 0 },
    { ra: 300, dec: 79, fov: 12, rotation: 0.4, projection: 0 }
  ];
  const rnd = rng(7);
  for (let i = 0; i < 40; i++) {
    const sign = rnd() < 0.5 ? -1 : 1;
    cams.push({ ra: rnd() * 360, dec: sign * (75 + rnd() * 15), fov: 5 + rnd() * 60, rotation: rnd() * 360, projection: 0 });
  }
  const S = require("../src/core/sky.js");
  for (const cam of cams) {
    for (const L of [1, 2, 3]) {
      const planned = I.visibleTiles(L, cam, FRAME_W, FRAME_H);
      const keys = new Set(planned.map((t) => t.row + "_" + t.col));
      for (let i = 0; i <= 120; i++) for (let j = 0; j <= 120; j++) {
        const x = -FRAME_W / 2 + i * FRAME_W / 120, y = -FRAME_H / 2 + j * FRAME_H / 120;
        const radec = S.unproject(cam, FRAME_W, x, y);
        const t = I.tileOf(L, radec[0], radec[1]);
        assert.ok(keys.has(t.row + "_" + t.col), "L" + L + " dec " + cam.dec + " misses " + t.row + "_" + t.col);
      }
    }
  }
});

test("a camera whose px/deg sits inside L2's fade window plans L2 tiles", () => {
  // px/deg 20: above level 0 and 1's threshold of 11.4, so L1 is the frame's level, and L2 is fading in
  // (it is needed above 22.8 px/deg, and fades in from 22.8 times 2^-0.3).
  const fov = 4 * Math.atan(960 * (Math.PI / 180) / (2 * 20)) * 180 / Math.PI;
  const cam = { ra: 83.8, dec: 0, fov: fov, rotation: 0, projection: 0 };
  assert.equal(I.levelFor(cam, FRAME_W), 1);
  assert.ok(I.levelOpacity(2, cam, FRAME_W) > 0, "L2 is fading in");
  const plan = I.planTiles([cam], FRAME_W, FRAME_H);
  assert.ok(plan.items.some((t) => t.L === 2), "L2 tiles are planned");
});
