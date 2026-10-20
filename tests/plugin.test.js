const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ROOT, copyPlugin } = require("../tools/buildlib.js");
const { packageFiles, installText } = require("../tools/package.js");
const AstroReproject = require("../src/core/reproject.js");

// The CavalryAstro Reproject filter, adapted from Cavalry Geo's plugin.test.js.
const dir = path.join(ROOT, "plugin", "CavalryAstro_plugin");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const loadSksl = () => fs.readFileSync(path.join(dir, "reproject.sksl"), "utf8");
// The shader without its comments, so a commented-out uniform isn't counted.
const codeOf = (sksl) => sksl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
const DEG = Math.PI / 180;

const OWN = {
  camRa: "double", camDec: "double", camFov: "double", camRotation: "double",
  frameW: "double", viewScale: "double", viewOffset: "double2", gain: "double", softness: "double",
};
const ICONS = [
  { file: "cavalryAstro.png", size: 18 },
  { file: "cavalryAstro@2x.png", size: 36 },
  { file: "cavalryAstro_ae.png", size: 16 },
  { file: "cavalryAstro_ae@2x.png", size: 32 },
];

// The PNG's width, height and colour type, from its IHDR chunk.
function pngInfo(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  assert.deepEqual([...buf.subarray(1, 4)], [0x50, 0x4e, 0x47], file + " is a PNG");
  assert.equal(buf.toString("ascii", 12, 16), "IHDR", file + " starts with IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colourType: buf[25] };
}

test("definitions.json describes the reproject filter", () => {
  const defs = load("definitions.json").find((o) => o.type === "reproject");
  assert.ok(defs, "reproject definition");
  assert.equal(defs.author, "cavalryAstro");
  assert.equal(defs.superType, "thirdPartyFilter");
  assert.equal(defs.skslFile, "reproject.sksl");
  assert.ok(fs.existsSync(path.join(dir, defs.skslFile)));
  for (const k of Object.keys(OWN)) assert.equal(defs.attributes[k].type, OWN[k], k);
  assert.equal(defs.attributes.allowViewportClipping.default, false);
  assert.equal(defs.attributes.samplingQuality.default, 1);
  assert.deepEqual(defs.triggers.out, Object.keys(OWN));
  assert.deepEqual(defs.UI.attributeOrder, Object.keys(OWN));
  assert.equal(defs.UI.icon, "cavalryAstro.png");
});

test("definitions.json defaults and ranges", () => {
  const a = load("definitions.json").find((o) => o.type === "reproject").attributes;
  assert.equal(a.gain.default, 1);
  assert.equal(a.gain.min, 0);
  assert.equal(a.gain.max, 4);
  assert.equal(a.softness.default, 1);
  assert.equal(a.softness.min, 0);
  assert.equal(a.softness.max, 3);
  assert.equal(a.camFov.default, 60);
  assert.equal(a.camFov.min, 0.5);
  assert.equal(a.camFov.max, 220);
  // The sky shares no range on RA and Dec: RA wraps, and keyframes can pass 360 or go past ±90.
  assert.equal(a.camRa.min, undefined);
  assert.equal(a.camRa.max, undefined);
  assert.equal(a.camDec.min, undefined);
  assert.equal(a.camDec.max, undefined);
  assert.equal(a.viewScale.default, 1);
  assert.deepEqual(a.viewOffset.default, { x: 0, y: 0 });
  assert.equal(a.camRa.default, 0);
  assert.equal(a.camDec.default, 0);
  assert.equal(a.camRotation.default, 0);
  assert.equal(a.frameW.default, 1920);
});

test("the shader's uniforms and the filter's attributes match one to one", () => {
  const found = {};
  for (const m of codeOf(loadSksl()).matchAll(/uniform\s+(float2|float)\s+(\w+)\s*;/g)) found[m[2]] = m[1] === "float" ? "double" : "double2";
  assert.deepEqual(found, OWN);
  assert.match(codeOf(loadSksl()), /uniform\s+shader\s+image\s*;/);
});

test("strings.json names the layer and every attribute", () => {
  const strs = load("strings.json").find((o) => o.value && o.value.layerType === "reproject");
  assert.ok(strs, "strings object");
  assert.equal(strs.type, "layerStrings");
  assert.equal(strs.value.author, "cavalryAstro");
  assert.equal(strs.value.niceName, "CavalryAstro Reproject");
  assert.equal(strs.value.language, "en");
  for (const k of Object.keys(OWN)) assert.ok(strs.value.attributes[k] && strs.value.attributes[k][0], k);
  for (const v of JSON.stringify(strs.value)) assert.notEqual(v, "<", "no < in ui text");
});

test("the shader's constants mirror AstroReproject", () => {
  const sksl = codeOf(loadSksl());
  const constOf = (name) => Number(sksl.match(new RegExp("const\\s+float\\s+" + name + "\\s*=\\s*([\\d.]+)\\s*;"))[1]);
  assert.equal(constOf("SOURCE_PX"), AstroReproject.SOURCE_PX);
  assert.ok(Math.abs(constOf("D2R") - DEG) < 1e-15, "D2R");
  assert.ok(Math.abs(constOf("CLAMP_R") - 2 * Math.tan(60 * DEG)) < 1e-12, "CLAMP_R is 2·tan(60°)");
});

test("the shader guards atan(0,0) at the exact pole pixel", () => {
  assert.match(codeOf(loadSksl()), /vx\s*==\s*0\.0\s*&&\s*vy\s*==\s*0\.0/);
});

test("the icons are RGBA PNGs at the sizes the UI expects", () => {
  const defs = load("definitions.json").find((o) => o.type === "reproject");
  assert.equal(defs.UI.icon.replace(/\.png$/, "@2x.png"), "cavalryAstro@2x.png");
  for (const { file, size } of ICONS) {
    const info = pngInfo(file);
    assert.equal(info.width, size, file + " width");
    assert.equal(info.height, size, file + " height");
    assert.equal(info.colourType, 6, file + " is RGBA");
  }
});

test("copyPlugin copies the plugin folder", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-plugin-"));
  try {
    copyPlugin(tmp);
    assert.deepEqual(fs.readdirSync(path.join(tmp, "CavalryAstro_plugin")).sort(), [
      "cavalryAstro.png", "cavalryAstro@2x.png", "cavalryAstro_ae.png", "cavalryAstro_ae@2x.png",
      "definitions.json", "reproject.sksl", "strings.json",
    ]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("the release zip carries the plugin, and the installer does not install it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-dist-plugin-"));
  try {
    fs.writeFileSync(path.join(tmp, "CavalryAstro.js"), "x");
    fs.mkdirSync(path.join(tmp, "CavalryAstro_assets"));
    fs.writeFileSync(path.join(tmp, "CavalryAstro_assets", "a.txt"), "a");
    copyPlugin(tmp);
    const names = packageFiles(tmp, "9.9.9").map((f) => f.name);
    for (const n of ["definitions.json", "strings.json", "reproject.sksl", "cavalryAstro.png", "cavalryAstro@2x.png", "cavalryAstro_ae.png", "cavalryAstro_ae@2x.png"]) {
      assert.ok(names.includes("CavalryAstro_plugin/" + n), n);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.match(installText("9.9.9"), /CavalryAstro_plugin/);
  const install = fs.readFileSync(path.join(ROOT, "tools", "install.js"), "utf8");
  assert.doesNotMatch(install, /CavalryAstro_plugin/);
});

test("the shader softens the output pixel with a 5x5 Gaussian tap grid", () => {
  const code = codeOf(loadSksl());
  assert.match(code, /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*5\s*;/);
  assert.match(code, /for\s*\(\s*int\s+j\s*=\s*0\s*;\s*j\s*<\s*5\s*;/);
  assert.match(code, /exp\(/);
  assert.match(code, /softness\s*<=\s*0\.001/);
  assert.match(code, /image\.eval\(/);
});
