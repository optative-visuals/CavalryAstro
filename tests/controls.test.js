const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core/controls.js");

const V = "javaScript#V";
const SKY_ROWS = [
  "Camera · Centre RA", "Camera · Centre Dec", "Camera · Field of view", "Camera · Rotation",
  "Stars · Sky darkness (0 City – 100 Countryside)", "Stars · Size", "Stars · Glow",
  "Background · Colour",
  "Lines · Hide", "Lines · Colour", "Lines · Width",
  "Borders · Hide", "Borders · Colour", "Borders · Width",
  "Names · Hide", "Names · Colour", "Names · Size"
];
const REVEAL_ROWS = (n) => [
  "Amount %", "Spotlight", "Lines colour", "Lines width", "Border colour", "Border width",
  "Title mode (0 Header · 1 Follows constellation)",
  "Title corner (0 top-left · 1 top-centre · 2 top-right · 3 bottom-left · 4 bottom-centre · 5 bottom-right)",
  "Title margin", "Title offset", "Title size", "Title colour",
  "Labels size", "Labels colour"
].map((l) => "Reveal " + n + " · " + l);

function sky(extra) {
  const st = () => ({});
  return Object.assign({
    valuesId: V, camera: "cam", background: "bg",
    bands: [{ id: "b0", state: st() }, { id: "b1", state: st() }],
    glow: { id: "glow", state: st() }, glowLevel: "gl",
    lines: "lines", borders: "borders", names: "names", reveals: []
  }, extra);
}
function reveal(n, extra) {
  return Object.assign({
    id: "rg" + n, number: n, name: n === 1 ? "Orion" : "Orion", amount: "amt" + n,
    lines: "rl" + n, border: { id: "rb" + n, state: {} }, borderGlow: { id: "rgl" + n, state: {} },
    labels: "rlab" + n, title: "title" + n
  }, extra);
}
function labels(p) { return p.rows.map((r) => r.label); }
function row(p, label) { return p.rows.find((r) => r.label === label); }

test("a sky with no reveals has exactly the Sky controls rows, in order, all in the main component", () => {
  const p = C.plan(sky());
  assert.deepEqual(labels(p), SKY_ROWS);
  assert.ok(p.groups.every((g) => g === "main"));
});

test("sky rows drive their real layers and attributes", () => {
  const p = C.plan(sky());
  assert.deepEqual(row(p, "Camera · Centre RA"), { kind: "direct", layer: "cam", attr: "array.0", label: "Camera · Centre RA" });
  assert.deepEqual(row(p, "Camera · Rotation").attr, "array.3");
  assert.deepEqual(row(p, "Background · Colour"), { kind: "direct", layer: "bg", attr: "material.materialColor", label: "Background · Colour" });
  assert.deepEqual(row(p, "Lines · Colour").attr, "stroke.strokeColor");
  assert.deepEqual(row(p, "Borders · Width").attr, "stroke.width");
  assert.equal(row(p, "Names · Hide").attr, "hidden");
  assert.equal(row(p, "Names · Size").attr, "generator.array.7", "textSize is the texts shape's input after the sky inputs");
  assert.equal(row(p, "Stars · Glow").layer, "gl", "Stars · Glow is the glow level utility");
  assert.equal(row(p, "Stars · Glow").attr, "array.1", "the glow level is the second input");
});

test("Stars · Sky darkness and Stars · Size each drive every band and the glow", () => {
  const p = C.plan(sky());
  const dark = row(p, "Stars · Sky darkness (0 City – 100 Countryside)"), size = row(p, "Stars · Size");
  assert.equal(dark.kind, "value");
  assert.deepEqual(dark.link.map((t) => t.layer), ["b0", "b1", "glow"]);
  assert.ok(dark.link.every((t) => t.attr === "generator.array.7"), "darkness input");
  assert.deepEqual(dark.overrides, { hardMin: 0, hardMax: 100 });
  assert.deepEqual(size.link.map((t) => t.layer), ["b0", "b1", "glow"]);
  assert.ok(size.link.every((t) => t.attr === "generator.array.8"), "size input");
  assert.equal(size.start, 1, "a new size input begins at the bands' default size");
});

test("with two reveals, the Reveal controls hold both blocks with their numbers, after the Sky rows", () => {
  const p = C.plan(sky({ reveals: [reveal(1), reveal(2)] }));
  assert.deepEqual(labels(p).slice(0, SKY_ROWS.length), SKY_ROWS);
  const revealRows = p.rows.filter((r, i) => p.groups[i] === "reveal").map((r) => r.label);
  assert.deepEqual(revealRows, REVEAL_ROWS(1).concat(REVEAL_ROWS(2)));
  assert.ok(p.groups.slice(0, SKY_ROWS.length).every((g) => g === "main"));
});

test("reveal rows drive the amount, the lines, the border with its glow, the title and the labels", () => {
  const p = C.plan(sky({ reveals: [reveal(1)] }));
  assert.deepEqual(row(p, "Reveal 1 · Amount %"), { kind: "direct", layer: "amt1", attr: "array.0", label: "Reveal 1 · Amount %", overrides: { hardMin: 0, hardMax: 100 }, notes: "Orion" });
  assert.equal(row(p, "Reveal 1 · Spotlight").attr, "array.1");
  assert.equal(row(p, "Reveal 1 · Lines colour").attr, "stroke.strokeColor");
  assert.equal(row(p, "Reveal 1 · Lines colour").layer, "rl1");
  const border = row(p, "Reveal 1 · Border colour");
  assert.equal(border.kind, "value");
  assert.deepEqual(border.link.map((t) => t.layer), ["rb1", "rgl1"]);
  assert.ok(border.link.every((t) => t.attr === "stroke.strokeColor"));
  assert.equal(row(p, "Reveal 1 · Title mode (0 Header · 1 Follows constellation)").attr, "array.2");
  assert.equal(row(p, "Reveal 1 · Title corner (0 top-left · 1 top-centre · 2 top-right · 3 bottom-left · 4 bottom-centre · 5 bottom-right)").attr, "array.3");
  assert.equal(row(p, "Reveal 1 · Title size").layer, "title1");
  assert.equal(row(p, "Reveal 1 · Title size").attr, "fontSize");
  assert.equal(row(p, "Reveal 1 · Labels size").attr, "generator.array.7");
});

test("the reveal rows the spec asks for: title and labels colours, border width, title margin and offset", () => {
  const p = C.plan(sky({ reveals: [reveal(1)] }));
  assert.equal(row(p, "Reveal 1 · Title colour").layer, "title1");
  assert.equal(row(p, "Reveal 1 · Title colour").attr, "material.materialColor");
  assert.equal(row(p, "Reveal 1 · Labels colour").layer, "rlab1");
  assert.equal(row(p, "Reveal 1 · Labels colour").attr, "material.materialColor");
  const width = row(p, "Reveal 1 · Border width");
  assert.equal(width.kind, "value");
  assert.deepEqual(width.link.map((t) => t.layer), ["rb1", "rgl1"]);
  assert.ok(width.link.every((t) => t.attr === "stroke.width"));
  assert.equal(row(p, "Reveal 1 · Title margin").attr, "array.4", "the margin is the reveal's margin input");
  assert.equal(row(p, "Reveal 1 · Title margin").layer, "amt1");
  assert.equal(row(p, "Reveal 1 · Title offset").attr, "array.5", "the title offset is the reveal's offsetY input");
});

test("the title's margin and offset rows drop with the title; the border width drops with the rings", () => {
  const p = C.plan(sky({ reveals: [reveal(1, { title: null, border: null, borderGlow: null })] }));
  const names = labels(p).filter((l) => l.indexOf("Reveal 1") === 0);
  ["Title margin", "Title offset", "Title colour", "Title size", "Border width", "Border colour"].forEach((part) => {
    assert.ok(names.every((l) => l.indexOf(part) < 0), part + " is not drawn, so it has no row");
  });
});

test("a reveal part that is not drawn drops its rows; the amount rows always stay", () => {
  const p = C.plan(sky({ reveals: [reveal(1, { lines: null, borderGlow: null, border: null, labels: null, title: null })] }));
  assert.deepEqual(labels(p).filter((l) => l.indexOf("Reveal 1") === 0), ["Reveal 1 · Amount %", "Reveal 1 · Spotlight"]);
});

test("linking rules: a target set apart on purpose or keyed is not relinked; one wired to our input counts as linked", () => {
  const st = (s) => Object.assign({ from: "", keyed: false, record: null }, s);
  const p = C.plan(sky({
    bands: [{ id: "b0", state: { "generator.array.7": st({ record: C.recordFor(V, "stars:darkness") }) } }, { id: "b1", state: { "generator.array.7": st({ from: V + ".array.2" }) } }],
    glow: { id: "glow", state: { "generator.array.7": st({ keyed: true }) } }
  }));
  const dark = row(p, "Stars · Sky darkness (0 City – 100 Countryside)");
  assert.deepEqual(dark.linked, [{ layer: "b1", attr: "generator.array.7" }], "wired to ours: kept as linked");
  assert.deepEqual(dark.link, [], "b0 was unlinked on purpose and the glow is keyed: neither is relinked");
});
