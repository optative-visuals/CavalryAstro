const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/core/catalog.js");

const ROOT = path.resolve(__dirname, "..");
const starsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "sky", "stars.json"), "utf8"));
const consJson = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "sky", "constellations.json"), "utf8"));
const stars = C.decodeStars(starsJson);
const cons = C.decodeConstellations(consJson);

function starIndex(name) {
  for (let i = 0; i < stars.count; i++) if (stars.name[i] === name) return i;
  return -1;
}

test("GREEK maps the Bayer abbreviations to Greek letters in alphabet order", () => {
  assert.equal(C.GREEK.length, 24);
  assert.deepEqual(C.GREEK[0], ["Alp", "α"]);
  assert.deepEqual(C.GREEK[23], ["Ome", "ω"]);
  assert.deepEqual(C.GREEK[14], ["Omi", "ο"]);
});

test("decodeStars and decodeConstellations keep the documented fields", () => {
  assert.equal(stars.count, starsJson.rows.length);
  assert.equal(stars.ra.length, stars.count);
  assert.equal(cons.length, 88);
  assert.equal(typeof cons[0].id, "string");
  assert.equal(cons[0].centre.length, 2);
});

test("search finds Orion first for 'ori'", () => {
  const r = C.search("ori", cons, stars);
  assert.equal(r[0].kind, "constellation");
  assert.equal(r[0].label, "Orion");
  assert.equal(r[0].index, C.findConstellation(cons, "Ori"));
});

test("search finds Betelgeuse for 'betel'", () => {
  const r = C.search("betel", cons, stars);
  assert.ok(r.some((h) => h.kind === "star" && h.label === "Betelgeuse"));
});

test("search is case and accent insensitive", () => {
  const r = C.search("ÖRION", cons, stars);
  assert.ok(r.some((h) => h.kind === "constellation" && h.index === C.findConstellation(cons, "Ori")));
});

test("search returns nothing for an empty query and respects the limit", () => {
  assert.deepEqual(C.search("", cons, stars), []);
  assert.ok(C.search("a", cons, stars, 5).length <= 5);
});

test("findConstellation accepts ids, Latin names and English names", () => {
  const cru = C.findConstellation(cons, "Cru");
  assert.ok(cru >= 0);
  assert.equal(C.findConstellation(cons, "Crux"), cru);
  assert.equal(C.findConstellation(cons, "Cross"), cru); // d3-celestial's English name for Crux
  assert.equal(C.findConstellation(cons, "Nonesuch"), -1);
});

test("constellationAt finds the constellation under a point, including the RA wrap and the poles", () => {
  const b = starIndex("Betelgeuse");
  assert.equal(C.constellationAt(cons, stars.ra[b], stars.dec[b]), C.findConstellation(cons, "Ori"));
  assert.equal(C.constellationAt(cons, 1.0, 10.0), C.findConstellation(cons, "Psc"));
  assert.equal(C.constellationAt(cons, 0.0, 89.5), C.findConstellation(cons, "UMi"));
  assert.equal(C.constellationAt(cons, 123.0, 89.5), C.findConstellation(cons, "UMi"));
  assert.equal(C.constellationAt(cons, 200.0, -89.5), C.findConstellation(cons, "Oct"));
});

test("constellationAt finds Serpens Cauda, the second border ring of Serpens", () => {
  assert.equal(C.constellationAt(cons, 275.0, -5.0), C.findConstellation(cons, "Ser"));
});
