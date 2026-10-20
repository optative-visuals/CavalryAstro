const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const E = require("../src/core/expression.js");
const { buildRuntimeSource } = require("../tools/buildlib.js");

class FakePath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(["M", x, y]); }
  lineTo(x, y) { this.ops.push(["L", x, y]); }
  close() { this.ops.push(["Z"]); }
  addEllipse(x, y, rx, ry) { this.ops.push(["E", x, y, rx, ry]); }
  addText(t, size, x, y) { this.ops.push(["T", t, size, x, y]); }
}
const RUNTIME = buildRuntimeSource("sky");
const meta = { sky: "sky#1", category: "stars" };
const data = { ra: [83.8, 85.2], dec: [-5.4, -1.2], mag: [1, 2] };
const renamed = { camRa: 83.8, camDec: -5.4, camFov: 60, camRotation: 0, camProjection: 0, compW: 1920, compH: 1080 };
const indexed = { n0: 83.8, n1: -5.4, n2: 60, n3: 0, n4: 0, n5: 1920, n6: 1080 };

test("the sky runtime is ES5 and does not include the catalogue", () => {
  assert.doesNotThrow(() => new vm.Script(RUNTIME));
  assert.equal(RUNTIME.includes("var AstroCatalog = (function"), false);
  assert.ok(RUNTIME.includes("var AstroRender"));
});

test("layerExpression embeds the ASTRO_META tag and readTag returns the meta", () => {
  const expr = E.layerExpression(RUNTIME, "stars", data, meta, {});
  assert.ok(expr.includes("/*ASTRO_META "));
  assert.deepEqual(E.readTag(expr, "ASTRO_META"), meta);
  assert.equal(E.readTag("no tag here", "ASTRO_META"), null);
});

test("layerExpression embeds the data between ASTRO_DATA markers", () => {
  const expr = E.layerExpression(RUNTIME, "stars", data, meta, {});
  assert.ok(expr.includes("var ASTRO_DATA = " + JSON.stringify(data) + ";"));
});

test("a stars expression evaluates with renamed inputs to a Path with ellipses", () => {
  const expr = E.layerExpression(RUNTIME, "stars", data, meta, {});
  const path = vm.runInNewContext(expr, Object.assign({ cavalry: { Path: FakePath }, darkness: 100, size: 1 }, renamed));
  assert.ok(path instanceof FakePath);
  assert.equal(path.ops.length, 2);
  assert.equal(path.ops[0][0], "E");
});

test("an expression with only nN names evaluates to the same ops as the renamed one", () => {
  const expr = E.layerExpression(RUNTIME, "stars", data, meta, {});
  const byName = vm.runInNewContext(expr, Object.assign({ cavalry: { Path: FakePath }, darkness: 100, size: 1 }, renamed));
  const byIndex = vm.runInNewContext(expr, Object.assign({ cavalry: { Path: FakePath } }, indexed));
  assert.deepEqual(byIndex.ops, byName.ops);
});

test("a lines expression honours the draw input", () => {
  const lines = { lines: [[[80, 0], [90, 0]]] };
  const expr = E.layerExpression(RUNTIME, "lines", lines, meta, {});
  const ctx = (extra) => Object.assign({ cavalry: { Path: FakePath } }, renamed, extra);
  assert.equal(vm.runInNewContext(expr, ctx({ draw: 0 })).ops.length, 0);
  assert.equal(vm.runInNewContext(expr, ctx({ draw: 1 })).ops.length, 2);
});

test("a texts expression evaluates with the label inputs", () => {
  const expr = E.layerExpression(RUNTIME, "texts", { items: [["Orion", 83.8, -5.4]] }, meta, {});
  const path = vm.runInNewContext(expr, Object.assign({ cavalry: { Path: FakePath }, textSize: 18, dx: 2, dy: 0 }, renamed));
  assert.equal(path.ops.length, 1);
  assert.equal(path.ops[0][0], "T");
});

test("a border expression evaluates to a Path", () => {
  const border = { rings: [[[80, 0], [90, 0], [90, 10], [80, 10]]] };
  const expr = E.layerExpression(RUNTIME, "border", border, meta, {});
  const path = vm.runInNewContext(expr, Object.assign({ cavalry: { Path: FakePath } }, renamed));
  assert.equal(path.ops.length, 5);
});

test("an unknown kind is refused when the expression is built", () => {
  assert.throws(() => E.layerExpression(RUNTIME, "planets", data, meta, {}));
});

test("the camera expression is a JavaScript Utility returning 0", () => {
  assert.equal(E.cameraExpression(), "0;");
});

test("the input lists match the design", () => {
  assert.deepEqual(E.CAMERA_INPUTS, [["centreRa", 83.8], ["centreDec", 0], ["fov", 60], ["rotation", 0], ["projection", 0]]);
  assert.deepEqual(E.SKY_INPUTS, [["camRa", 0], ["camDec", 0], ["camFov", 60], ["camRotation", 0], ["camProjection", 0], ["compW", 1920], ["compH", 1080]]);
  assert.deepEqual(E.STAR_INPUTS.slice(7), [["darkness", 100], ["size", 1]]);
  assert.deepEqual(E.LINE_INPUTS.slice(7), [["draw", 1]]);
  assert.deepEqual(E.TEXT_INPUTS.slice(7), [["textSize", 18], ["dx", 0], ["dy", 0]]);
});

test("the View position driver evaluates to viewFor().position at an off-centre camera", () => {
  const R = require("../src/core/reproject.js");
  const cam = { ra: 84, dec: 7.3, fov: 62.5, rotation: 0, projection: 0 };
  const ctx = vm.createContext({ camRa: 84, camDec: 7.3, camFov: 62.5, camRotation: 0, camProjection: 0 });
  const src = E.imageryViewExpression(buildRuntimeSource("reproject"), "position", 1920, 1080, {});
  const got = vm.runInContext(src, ctx);
  assert.deepEqual([...got], R.viewFor(cam, 1920, 1080).position);
});

test("the level driver expression evaluates to AstroImagery.levelVisibleOpacity for each level and top planned level", () => {
  const I = require("../src/core/imagery.js");
  const src = buildRuntimeSource("reproject");
  const cams = [
    { ra: 83.8, dec: 0, fov: 180, rotation: 0, projection: 0 },
    { ra: 83.8, dec: -5.4, fov: 60, rotation: 0, projection: 0 },
    { ra: 0, dec: 0, fov: 20, rotation: 0.3, projection: 0 },
    { ra: 83.8, dec: 0, fov: 2, rotation: 0, projection: 0 }
  ];
  for (const cam of cams) {
    const ctx = vm.createContext({ camRa: cam.ra, camDec: cam.dec, camFov: cam.fov, camRotation: cam.rotation, camProjection: 0 });
    for (const top of [1, 2, 3]) {
      for (let L = 0; L <= top; L++) {
        const expr = E.imageryLevelExpression(src, L, 1920, top, {});
        assert.equal(vm.runInContext(expr, ctx), I.levelVisibleOpacity(L, cam, 1920, top), "L" + L + " top " + top + " fov " + cam.fov);
      }
    }
  }
});
