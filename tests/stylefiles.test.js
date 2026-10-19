const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/core/styles.js");
const F = require("../src/core/stylefiles.js");

const s = T.normalise({ name: "Ocean", lines: "#123456" });
const dup = (name) => T.normalise({ name: name, lines: "#654321" });

test("file names: punctuation replaced, trailing dots and spaces dropped, empty falls back", () => {
  assert.equal(F.fileName("Night Blue"), "Night Blue.json");
  assert.equal(F.fileName("Night/Day: v2?"), "Night-Day- v2-.json");
  assert.equal(F.fileName("  "), "Style.json");
  assert.equal(F.fileName("a."), "a.json");
});

test("file names: Windows device names get a dash so they are never device files", () => {
  assert.equal(F.fileName("CON"), "CON-.json");
  assert.equal(F.fileName("lpt1 "), "lpt1-.json");
  assert.equal(F.fileName("com9."), "com9-.json");
  assert.equal(F.fileName("Console"), "Console.json");
  assert.equal(F.fileName("CON.x"), "CON-.x.json");
});

test("file names: tabs and backslashes become dashes", () => {
  assert.equal(F.fileName("a\\b\tc"), "a-b-c.json");
});

test("style text round trips through fromText", () => {
  assert.deepEqual(F.fromText(F.toText(s)), s);
  assert.equal(JSON.parse(F.toText(s)).cavalryAstroStyle, 1);
});

test("fromText rejects bad JSON, missing marker, missing name and built-in names", () => {
  assert.equal(F.fromText("{"), null);
  assert.equal(F.fromText('{"name":"x"}'), null);
  assert.equal(F.fromText('{"cavalryAstroStyle":1}'), null);
  assert.equal(F.fromText('{"cavalryAstroStyle":1,"name":"Neon"}'), null);
});

test("readAll keeps the first of each name and skips the rest", () => {
  const out = F.readAll([
    { path: "A/a.json", text: F.toText(s) },
    { path: "A/b.json", text: F.toText(s) },
    { path: "A/n.json", text: "{}" }
  ]);
  assert.equal(out.styles.length, 1);
  assert.equal(out.styles[0].name, "Ocean");
  assert.deepEqual(out.skipped, ["A/b.json", "A/n.json"]);
});

test("readAll reports the path of each kept style by lowercased name", () => {
  const out = F.readAll([
    { path: "A/a.json", text: F.toText(s) },
    { path: "A/b.json", text: F.toText(s) },
    { path: "A/n.json", text: "{}" }
  ]);
  assert.deepEqual(out.paths, { ocean: "A/a.json" });
});

test("readAll skips a third file whose name differs only in case", () => {
  const out = F.readAll([
    { path: "A/Ocean.json", text: F.toText(s) },
    { path: "A/OCEAN.json", text: F.toText(dup("OCEAN")) }
  ]);
  assert.equal(out.styles.length, 1);
  assert.deepEqual(out.skipped, ["A/OCEAN.json"]);
  assert.deepEqual(out.paths, { ocean: "A/Ocean.json" });
});

test("readAll says why each file was skipped, and names the styles it read", () => {
  const out = F.readAll([
    { path: "A/a.json", text: F.toText(s) },
    { path: "A/b.json", text: F.toText(s) },
    { path: "A/n.json", text: "{}" }
  ]);
  assert.deepEqual(out.reasons, { "A/b.json": "duplicate", "A/n.json": "not-style" });
  assert.equal(out.names["A/b.json"], "Ocean");
  assert.equal(out.names["A/n.json"], undefined);
});

test("movePlan reads themes from settings, de-duplicated, built-ins left out", () => {
  assert.deepEqual(F.movePlan({}), []);
  assert.equal(F.movePlan({ themes: [s, s] }).length, 1);
  assert.deepEqual(F.movePlan({ themes: [T.normalise({ name: "Neon" })] }), []);
});

test("constants", () => {
  assert.equal(F.MARKER, "cavalryAstroStyle");
  assert.equal(F.FOLDER, "Sky styles");
});
