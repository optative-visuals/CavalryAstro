const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Checks the committed sky data (assets/sky) that tools/build-sky-data.js writes.
const ROOT = path.resolve(__dirname, "..");
const starsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "sky", "stars.json"), "utf8"));
const consJson = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "sky", "constellations.json"), "utf8"));
const list = consJson.list;

// Great-circle separation in degrees (haversine).
function sepDeg(ra1, dec1, ra2, dec2) {
  const r = Math.PI / 180;
  const dDec = (dec2 - dec1) * r, dRa = (ra2 - ra1) * r;
  const h = Math.sin(dDec / 2) * Math.sin(dDec / 2) +
    Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.sin(dRa / 2) * Math.sin(dRa / 2);
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / r;
}

test("stars.json has the documented shape", () => {
  assert.equal(starsJson.v, 1);
  assert.deepEqual(starsJson.cols, ["ra", "dec", "mag", "bv", "con", "name", "bayer"]);
  let prevMag = -Infinity;
  for (const row of starsJson.rows) {
    assert.equal(row.length, 7);
    const [ra, dec, mag, bv, con, name, bayer] = row;
    assert.ok(ra >= 0 && ra < 360, "ra in [0,360)");
    assert.ok(dec >= -90 && dec <= 90, "dec in [-90,90]");
    assert.ok(mag <= 7.0, "mag cut at 7.0");
    assert.ok(mag >= prevMag, "rows sorted brightest first");
    assert.ok(Number.isFinite(bv));
    assert.ok(con >= -1 && con < list.length, "conIndex is -1 or a constellation index");
    assert.equal(typeof name, "string");
    assert.equal(typeof bayer, "string");
    prevMag = mag;
  }
});

test("there are 88 constellations, sorted by id with unique ids", () => {
  assert.equal(consJson.v, 1);
  assert.equal(list.length, 88);
  const ids = list.map((c) => c.id);
  assert.deepEqual(ids, ids.slice().sort());
  assert.equal(new Set(ids).size, 88);
});

test("every constellation has lines, border rings of at least 4 points and stars", () => {
  for (const c of list) {
    assert.ok(c.lines.length >= 1, c.id + " has a line");
    assert.ok(c.border.length >= 1, c.id + " has a border");
    for (const ring of c.border) assert.ok(ring.length >= 4, c.id + " has a ring of at least 4 points");
    assert.ok(c.stars.length >= 1, c.id + " has stars");
  }
});

test("Serpens has exactly 2 border rings (Caput and Cauda), every other constellation has 1", () => {
  const ser = list.find((c) => c.id === "Ser");
  assert.equal(ser.border.length, 2);
  for (const c of list) if (c.id !== "Ser") assert.equal(c.border.length, 1, c.id);
});

test("every line vertex is an exact bundled star position", () => {
  const keys = new Set(starsJson.rows.map((r) => r[0] + "," + r[1]));
  for (const c of list) {
    for (const line of c.lines) {
      for (const [ra, dec] of line) {
        assert.ok(keys.has(ra + "," + dec), c.id + " vertex " + ra + "," + dec + " is not a star");
      }
    }
  }
});

test("Betelgeuse is the Orion alpha star", () => {
  const ori = list.findIndex((c) => c.id === "Ori");
  const row = starsJson.rows.find((r) => r[5] === "Betelgeuse");
  assert.ok(row, "Betelgeuse exists");
  assert.equal(row[4], ori);
  assert.equal(row[6], "α");
  assert.ok(Math.abs(row[0] - 88.79) < 0.01, "ra " + row[0]);
  assert.ok(Math.abs(row[1] - 7.41) < 0.01, "dec " + row[1]);
});

test("star count is between 12000 and 20000", () => {
  assert.ok(starsJson.rows.length >= 12000 && starsJson.rows.length <= 20000, String(starsJson.rows.length));
});

test("consecutive border points are at most 1.01 degrees apart, including the closing edge of each ring", () => {
  for (const c of list) {
    for (const b of c.border) {
      for (let i = 0; i < b.length; i++) {
        const j = (i + 1) % b.length;
        const d = sepDeg(b[i][0], b[i][1], b[j][0], b[j][1]);
        assert.ok(d <= 1.01, c.id + " border gap " + d.toFixed(3) + " at " + i);
      }
    }
  }
});
