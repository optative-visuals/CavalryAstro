const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const St = require("../src/core/stars.js");

test("limitFor maps darkness 0..100 to magnitude 3..7", () => {
  assert.equal(St.limitFor(0), 3);
  assert.equal(St.limitFor(100), 7);
  assert.equal(St.limitFor(50), 5);
});

test("radius strictly decreases from magnitude -1.5 to 6 at limit 7", () => {
  let prev = Infinity;
  for (let mag = -1.5; mag <= 6.0001; mag += 0.25) {
    const r = St.radius(mag, 7, 1);
    assert.ok(r >= 0, "negative radius at " + mag);
    assert.ok(r < prev, "not decreasing at " + mag);
    prev = r;
  }
});

test("radius is 10 px for magnitude -1.5 and 1.0 px for magnitude 6 at size 1", () => {
  assert.ok(Math.abs(St.radius(-1.5, 7, 1) - 10) < 1e-9);
  assert.ok(Math.abs(St.radius(6, 7, 1) - 1.0) < 1e-9);
});

test("radius scales linearly with size", () => {
  assert.ok(Math.abs(St.radius(2, 7, 2.5) - 2.5 * St.radius(2, 7, 1)) < 1e-9);
});

test("radius fades to nothing across the last half magnitude before the limit", () => {
  assert.ok(St.radius(6.8, 7, 1) > 0);
  assert.equal(St.radius(7.0, 7, 1), 0);
  assert.ok(St.radius(6.9, 7, 1) < St.radius(6.8, 7, 1));
});

test("BANDS holds the seven B-V upper bounds, with the default colours", () => {
  assert.deepEqual(St.BANDS, [-0.1, 0.15, 0.45, 0.7, 1.0, 1.4, Infinity]);
  assert.deepEqual(St.BAND_COLOURS, ["#9bb0ff", "#c3d1ff", "#f2f4ff", "#fff4e0", "#ffe2b8", "#ffc58f", "#ffa66b"]);
});

test("bandOf places Vega in band 1 and Betelgeuse in band 6", () => {
  assert.equal(St.bandOf(-0.03), 1);
  assert.equal(St.bandOf(1.85), 6);
});

test("bandOf treats each upper bound as inclusive and covers the extremes", () => {
  assert.equal(St.bandOf(-5), 0);
  assert.equal(St.bandOf(-0.1), 0);
  assert.equal(St.bandOf(0.15), 1);
  assert.equal(St.bandOf(1e9), 6);
});

test("labelText: proper name first, then Bayer and constellation", () => {
  assert.equal(St.labelText("", "δ", "Ori", "bayer"), "δ Ori");
  assert.equal(St.labelText("Rigel", "β", "Ori", "bayer"), "Rigel");
  assert.equal(St.labelText("", "", "Ori", "bayer"), "");
  assert.equal(St.labelText("", "δ", "", "bayer"), "δ");
});

test("labelText bayer-latin writes the Greek letter as its 3-letter abbreviation", () => {
  assert.equal(St.labelText("", "δ", "Ori", "bayer-latin"), "del Ori");
  assert.equal(St.labelText("Rigel", "β", "Ori", "bayer-latin"), "Rigel");
  assert.equal(St.labelText("", "α1", "Ori", "bayer-latin"), "alp1 Ori");
});

test("stars.js runs with no catalog and no require (in-layer runtime): latin falls back to the Bayer form", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "stars.js"), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.equal(sandbox.AstroStars.labelText("", "δ", "Ori", "bayer-latin"), "δ Ori");
  assert.equal(sandbox.AstroStars.bandOf(-0.03), 1);
});
