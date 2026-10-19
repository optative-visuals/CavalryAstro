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
