const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/core/styles.js");
const AstroStars = require("../src/core/stars.js");

const HEX = /^#[0-9a-fA-F]{6}$/;
const realistic = T.find("Realistic", []);

test("five built-in names in order", () => {
  assert.deepEqual(T.names([]), ["Realistic", "Mono", "Blueprint", "Vintage chart", "Neon"]);
  assert.equal(T.BUILT_IN.length, 5);
});

test("every built-in has every colour and width role as a hex colour or a number", () => {
  T.BUILT_IN.forEach((t) => {
    T.ROLES.forEach((r) => assert.match(t[r], HEX, t.name + " " + r));
    T.WIDTH_ROLES.forEach((r) => assert.ok(typeof t[r] === "number" && t[r] >= 0, t.name + " " + r));
    assert.ok(t.glow >= 0 && t.glow <= 1, t.name + " glow");
    assert.match(t.starColour, HEX, t.name + " starColour");
  });
});

test("Realistic is true-colour on a dark background with glow 0.6", () => {
  assert.equal(realistic.name, "Realistic");
  assert.equal(realistic.starMode, "true");
  assert.equal(realistic.background, "#05070d");
  assert.equal(realistic.glow, 0.6);
});

test("starColours: Realistic gives the true colour bands, Mono gives seven copies of one colour", () => {
  assert.deepEqual(T.starColours(realistic), AstroStars.BAND_COLOURS);
  const mono = T.find("Mono", []);
  const cols = T.starColours(mono);
  assert.equal(cols.length, 7);
  assert.ok(cols.every((c) => c === mono.starColour));
});

test("normalise keeps the given roles and fills the rest from Realistic", () => {
  const t = T.normalise({ lines: "#ff0000" });
  assert.equal(t.lines, "#ff0000");
  assert.equal(t.background, realistic.background);
  assert.equal(t.linesWidth, realistic.linesWidth);
  assert.equal(t.starMode, realistic.starMode);
});

test("normalise rejects non-objects", () => {
  assert.equal(T.normalise("x"), null);
  assert.equal(T.normalise(null), null);
  assert.equal(T.normalise(42), null);
});

test("normalise replaces bad values with Realistic's, and clamps glow", () => {
  const t = T.normalise({ lines: "red", linesWidth: -2, starMode: "rainbow", glow: 9, nameCase: "lower", titleFont: "  " });
  assert.equal(t.lines, realistic.lines);
  assert.equal(t.linesWidth, realistic.linesWidth);
  assert.equal(t.starMode, "true");
  assert.equal(t.glow, 1);
  assert.equal(t.nameCase, realistic.nameCase);
  assert.equal(t.titleFont, realistic.titleFont);
});

test("find: built-ins by name, case-insensitively, then saved themes; unknown names fall back to Realistic", () => {
  assert.equal(T.find("neon", []).name, "Neon");
  const saved = [T.normalise({ name: "Night", lines: "#123456" })];
  assert.equal(T.find("Night", saved).lines, "#123456");
  assert.equal(T.find("Nope", saved).name, "Realistic");
});

test("names lists built-ins first, then saved names", () => {
  assert.deepEqual(T.names([T.normalise({ name: "Night" })]).slice(-1), ["Night"]);
  assert.equal(T.names([T.normalise({ name: "Night" })])[0], "Realistic");
});

test("isBuiltIn ignores case and surrounding spaces", () => {
  assert.equal(T.isBuiltIn(" vintage CHART "), true);
  assert.equal(T.isBuiltIn("Night"), false);
});

test("previewColors gives the six preview keys with the green frame", () => {
  const p = T.previewColors(realistic);
  assert.deepEqual(Object.keys(p).sort(), ["background", "borders", "frame", "lines", "names", "star"]);
  assert.equal(p.background, realistic.background);
  assert.equal(p.frame, "#2fbf71");
  assert.match(p.star, HEX);
});
