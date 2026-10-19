// Sky preview: the maths (pan, zoom, frame, camera outline, hit-tests) and the ui.Draw panel that uses them.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../src/core/preview.js");
const S = require("../src/core/sky.js");
const C = require("../src/core/catalog.js");

const ROOT = path.resolve(__dirname, "..");
const starsJson = require("../assets/sky/stars.json");
const consJson = require("../assets/sky/constellations.json");
const STARS = C.decodeStars(starsJson);
const CONS = C.decodeConstellations(consJson);
const W = 640, H = 360;

// Signed RA difference in degrees, in (-180, 180].
function raDelta(a, b) { return ((a - b + 540) % 360 + 360) % 360 - 180; }
function camOf(v) { return { ra: v.ra, dec: v.dec, fov: v.fov, rotation: 0, projection: 0 }; }
function indexNamed(cons, id) { return cons.findIndex((c) => c.id === id); }
function starNamed(name) {
  for (let i = 0; i < STARS.count; i++) if (STARS.name[i] === name) return [STARS.ra[i], STARS.dec[i]];
  throw new Error("no star " + name);
}

// ---- The maths --------------------------------------------------------------------------------------

test("the preview exposes its frame fraction, 0.6 of the preview width", () => {
  assert.equal(P.FRAME_FRACTION, 0.6);
});

test("dragging right by the full width at fov 100 moves the view's RA by +80 to +120 degrees", () => {
  const v = { ra: 100, dec: 0, fov: 100 };
  const out = P.pan(v, W, 0, W);
  const d = raDelta(out.ra, v.ra);
  assert.ok(d >= 80 && d <= 120, "RA moved by " + d);
  assert.equal(out.dec, 0, "dec does not move on a sideways drag");
});

test("dragging left moves the RA back down, and dragging up and down moves dec", () => {
  const v = { ra: 100, dec: 0, fov: 100 };
  assert.ok(raDelta(P.pan(v, -W, 0, W).ra, v.ra) < -80);
  assert.ok(P.pan(v, 0, 40, W).dec > 0, "content moving down brings the north into view");
  assert.ok(P.pan(v, 0, -40, W).dec < 0);
});

test("pan at dec 89 clamps at 90 and never gives NaN", () => {
  const v = { ra: 10, dec: 89, fov: 100 };
  const up = P.pan(v, 0, 5000, W);
  assert.equal(up.dec, 90);
  [up.ra, up.dec, P.pan(up, 3000, 0, W).ra, P.pan(up, 0, 0, W).dec].forEach((n) => assert.ok(Number.isFinite(n)));
  assert.equal(P.pan(v, 0, -5000, W).dec, -90, "and clamps at -90 going down");
  assert.ok(Number.isFinite(P.pan({ ra: 0, dec: -90, fov: 100 }, 20, 0, W).ra));
});

test("RA stays wrapped into [0, 360) when panning", () => {
  const out = P.pan({ ra: 359, dec: 0, fov: 100 }, W, 0, W);
  assert.ok(out.ra >= 0 && out.ra < 360, "ra " + out.ra);
});

test("zoomAt keeps the point under the cursor fixed to within 0.01 degrees", () => {
  const v = { ra: 83.8, dec: 10, fov: 100 };
  const x = 200, y = 120;
  const before = S.unproject(camOf(v), W, x - W / 2, H / 2 - y);
  const z = P.zoomAt(v, 2, x, y, W, H);
  const after = S.unproject(camOf(z), W, x - W / 2, H / 2 - y);
  assert.ok(S.angularDistance(before[0], before[1], after[0], after[1]) < 0.01);
  assert.ok(z.fov < v.fov, "zooming in narrows the fov");
});

test("zoomAt keeps the fov in [5, 180]", () => {
  const v = { ra: 83.8, dec: 0, fov: 100 };
  assert.equal(P.zoomAt(v, 1e6, W / 2, H / 2, W, H).fov, 5);
  assert.equal(P.zoomAt(v, 1e-6, W / 2, H / 2, W, H).fov, 180);
});

test("dragZoom zooms in when the mouse moves up and keeps the press point still", () => {
  const v = { ra: 83.8, dec: 10, fov: 100 };
  const x = 320, y = 180;
  const up = P.dragZoom(v, x, y, y - 50, W, H);
  assert.ok(up.fov < v.fov, "up is in");
  const down = P.dragZoom(v, x, y, y + 50, W, H);
  assert.ok(down.fov > v.fov, "down is out");
  const before = S.unproject(camOf(v), W, 0, 0);
  const after = S.unproject(camOf(up), W, 0, 0);
  assert.ok(S.angularDistance(before[0], before[1], after[0], after[1]) < 0.01);
});

test("frameCamera is the exact camera of the green frame: fov 4 atan(0.6 tan(fov/4)), so 62.52 at fov 100", () => {
  const v = { ra: 83.8, dec: 10, fov: 100 };
  const cam = P.frameCamera(v);
  assert.equal(cam.ra, 83.8);
  assert.equal(cam.dec, 10);
  assert.ok(Math.abs(cam.fov - 62.523) < 0.001, "fov " + cam.fov);
  assert.ok(Math.abs(P.frameCamera({ ra: 0, dec: 0, fov: 180 }).fov - 123.9) < 0.1);
  const r = P.frameRect(W, H, 16 / 9);
  assert.ok(Math.abs(r.w - 0.6 * W) < 1e-9);
  assert.ok(Math.abs(r.x + r.w / 2 - W / 2) < 1e-9, "centred");
  assert.ok(Math.abs(r.y + r.h / 2 - H / 2) < 1e-9, "centred");
});

test("cameraRect outlines a centred camera as a box around the middle, and is null when off the view", () => {
  const v = { ra: 83.8, dec: 0, fov: 100 };
  const rect = P.cameraRect(v, { ra: 83.8, dec: 0, fov: 30 }, W, H, 16 / 9);
  assert.equal(rect.length, 4);
  const [x0, y0, x1, y1] = rect;
  assert.ok(x0 < x1 && y0 < y1, "a box");
  assert.ok(Math.abs((x0 + x1) / 2 - W / 2) < 1e-6 && Math.abs((y0 + y1) / 2 - H / 2) < 1e-6, "centred");
  assert.equal(P.cameraRect(v, { ra: 263.8, dec: 0, fov: 30 }, W, H, 16 / 9), null, "a camera on the far side is off the view");
});

// The green frame and the camera outline must agree: the camera frameCamera names, drawn in the same view,
// lands on the frame to within a pixel (for the frame's own aspect, 16:9 and square).
[[30, 640, 360, 16 / 9], [100, 640, 360, 16 / 9], [180, 640, 360, 16 / 9], [100, 400, 400, 1], [30, 400, 400, 1], [180, 400, 400, 1]]
  .forEach(([fov, w, h, aspect]) => {
    test("the camera outline matches the green frame within 1 px at fov " + fov + ", aspect " + aspect.toFixed(2), () => {
      const v = { ra: 83.8, dec: 0, fov: fov };
      const r = P.cameraRect(v, P.frameCamera(v), w, h, aspect);
      const f = P.frameRect(w, h, aspect);
      assert.ok(r, "the camera is on the view");
      assert.ok(Math.abs(r[0] - f.x) < 1 && Math.abs(r[1] - f.y) < 1, "top left " + r + " vs " + JSON.stringify(f));
      assert.ok(Math.abs(r[2] - (f.x + f.w)) < 1 && Math.abs(r[3] - (f.y + f.h)) < 1, "bottom right " + r);
    });
  });

test("hitDot returns the nearest point within the radius, or -1", () => {
  const pts = [[10, 10], [100, 100], [103, 100]];
  assert.equal(P.hitDot(pts, 12, 11, 6), 0);
  assert.equal(P.hitDot(pts, 101, 100, 6), 1, "the nearer of two");
  assert.equal(P.hitDot(pts, 50, 50, 6), -1);
});

test("dashes covers the outline of a rectangle with segments", () => {
  const segs = P.dashes({ x: 0, y: 0, w: 40, h: 20 }, 4, 3);
  assert.ok(segs.length > 0);
  segs.forEach((s) => assert.equal(s.length, 4));
});

test("the panel with a square comp draws a square green frame, and the frame matches the camera outline", () => {
  const ctx = panelContext();
  const panel = ctx.AstroPreviewPanel.create({});
  panel.setSky({ stars: STARS, constellations: CONS, theme: "Realistic" });
  panel.setCompSize(1080, 1080);
  panel.setWidth(400);
  const draw = panel.widget._items[1];
  assert.equal(draw._size[1], 400, "the Draw takes the comp's shape");
  panel.setCurrent(P.frameCamera(panel.view()));
  panel.redraw();
  // The frame is the stroked path of width 2; its corners are the first four points.
  const frame = draw._paths.find((p) => p.paint.stroke && p.paint.strokeWidth === 2).path.cmds.filter((c) => c[0] !== "close");
  const xs = frame.map((c) => c[1]), ys = frame.map((c) => c[2]);
  const fw = Math.max(...xs) - Math.min(...xs), fh = Math.max(...ys) - Math.min(...ys);
  assert.ok(Math.abs(fw - fh) < 1e-6, "square: " + fw + " x " + fh);
  assert.ok(Math.abs(fw - 0.6 * 400) < 1e-6);
  // The dashed camera outline (the frame camera) sits on the frame too.
  const dashes = draw._paths.find((p) => p.paint.strokeWidth === 1.2).path.cmds.filter((c) => c[0] === "moveTo");
  assert.ok(dashes.length > 0);
  const minX = Math.min(...dashes.map((c) => c[1])), maxX = Math.max(...dashes.map((c) => c[1]));
  assert.ok(Math.abs(minX - (400 - fw) / 2) < 1 && Math.abs(maxX - (400 + fw) / 2) < 1, "outline spans the frame");
});

test("hitConstellation at a projected Betelgeuse is Orion", () => {
  const [ra, dec] = starNamed("Betelgeuse");
  const v = { ra: ra, dec: dec, fov: 60 };
  const q = P.toPx(v, ra, dec, W, H);
  assert.ok(q, "Betelgeuse is on the view");
  assert.equal(P.hitConstellation(v, CONS, q[0], q[1], W, H), indexNamed(CONS, "Ori"));
});

test("hitConstellation at the centre of Cassiopeia's border is Cassiopeia, and a click above it is not", () => {
  const i = indexNamed(CONS, "Cas");
  const [ra, dec] = CONS[i].centre;
  const v = { ra: ra, dec: dec, fov: 60 };
  assert.equal(P.hitConstellation(v, CONS, W / 2, H / 2, W, H), i);
  // The view's y runs down: a point well above the centre is further north, outside the constellation's rings.
  assert.notEqual(P.hitConstellation(v, CONS, W / 2, 0, W, H), i);
});

test("starsForPreview keeps the stars at or brighter than magnitude 5 and no others", () => {
  const data = P.starsForPreview(STARS);
  let expected = 0;
  for (let i = 0; i < STARS.count; i++) if (STARS.mag[i] <= 5) expected++;
  assert.equal(data.count, expected);
  for (let i = 0; i < data.count; i++) assert.ok(data.mag[i] <= 5);
  assert.equal(P.starsForPreview(STARS, 2).count < data.count, true, "a lower limit keeps fewer");
});

// ---- The panel --------------------------------------------------------------------------------------

// Panel fakes in the style of tests/build.test.js: a Draw that records paths, Label and layouts, a Path
// that records its commands, and a Timer that never fires by itself.
function panelContext() {
  function Widget() { this._items = []; this._hidden = false; }
  Widget.prototype.setHidden = function (h) { this._hidden = !!h; };
  Widget.prototype.isHidden = function () { return this._hidden; };
  Widget.prototype.setMargins = function () {};
  Widget.prototype.setText = function (t) { this._text = t; };
  Widget.prototype.add = function (w) { this._items.push(w); };
  function Label(text) { Widget.call(this); this._text = text || ""; }
  Label.prototype = Object.create(Widget.prototype);
  function VLayout() { Widget.call(this); }
  VLayout.prototype = Object.create(Widget.prototype);
  function Draw() { Widget.call(this); this._paths = []; this._size = [0, 0]; this._redraws = 0; }
  Draw.prototype = Object.create(Widget.prototype);
  Draw.prototype.setSize = function (w, h) { this._size = [w, h]; };
  Draw.prototype.setMinimumWidth = function (w) { this._minW = w; };
  Draw.prototype.setMinimumHeight = function (h) { this._minH = h; };
  Draw.prototype.setBackgroundColor = function (c) { this._bg = c; };
  Draw.prototype.setToolTip = function () {};
  Draw.prototype.useHoverEvents = function (on) { this._hover = !!on; };
  Draw.prototype.addPath = function (p, paint) { this._paths.push({ path: p, paint: paint }); };
  Draw.prototype.clearPaths = function () { this._paths = []; };
  Draw.prototype.redraw = function () { this._redraws++; };
  function Path() { this._cmds = []; }
  ["moveTo", "lineTo", "close", "addEllipse", "addText", "addRect"].forEach((m) => {
    Path.prototype[m] = function () { this._cmds.push([m].concat(Array.prototype.slice.call(arguments))); };
  });
  Path.prototype.toObject = function () { return { cmds: this._cmds.slice() }; };
  const timers = [];
  function Timer(cb) { this.cb = cb; timers.push(this); }
  Timer.prototype.setRepeating = function () {};
  Timer.prototype.setInterval = function () {};
  Timer.prototype.start = function () {};
  Timer.prototype.stop = function () {};
  const ui = { Label: Label, VLayout: VLayout, Draw: Draw };
  const cavalry = { Path: Path };
  const api = { Timer: Timer };
  const sandbox = { ui: ui, cavalry: cavalry, api: api, console: console };
  const context = vm.createContext(sandbox);
  // The sky and preview files as the panel bundle loads them, in order (no require: each is a global).
  ["src/core/sky.js", "src/core/catalog.js", "src/core/stars.js", "src/core/styles.js", "src/core/preview.js",
    "src/cavalry/preview.js"].forEach((rel) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), context, { filename: rel });
  });
  return context;
}

test("create returns a widget, and redraw draws the sky without throwing when there are no results", () => {
  const ctx = panelContext();
  const panel = ctx.AstroPreviewPanel.create({ onPick: () => {} });
  assert.ok(panel.widget, "a widget");
  panel.setSky({ stars: STARS, constellations: CONS, theme: "Realistic" });
  panel.setView({ ra: 84, dec: 0, fov: 100 });
  panel.setWidth(W);
  panel.redraw();
  const draw = panel.widget._items[1];
  assert.ok(draw._paths.length > 0, "paths were drawn");
  assert.ok(draw._redraws >= 1, "redraw was called on the Draw");
  assert.equal(draw._minW, 120, "a small minimum width is re-applied after setSize");
  assert.equal(draw._minH, draw._size[1], "and the real height as the minimum height");
});

test("constellation names show when the fov is under 90 degrees, and not at 90 or more", () => {
  const ctx = panelContext();
  const panel = ctx.AstroPreviewPanel.create({});
  panel.setSky({ stars: STARS, constellations: CONS, theme: "Realistic" });
  panel.setWidth(W);
  const texts = () => panel.widget._items[1]._paths.reduce((n, p) =>
    n + p.path.cmds.filter((c) => c[0] === "addText").length, 0);
  panel.setView({ ra: 84, dec: 0, fov: 91 });
  panel.redraw();
  const wide = texts();
  panel.setView({ ra: 84, dec: 0, fov: 89 });
  panel.redraw();
  assert.ok(texts() >= wide + 5, "the same view under 90 degrees adds the names");
  assert.ok(panel.stats().names >= 5);
});

test("clicking a constellation calls onPick with its index, and a drag does not", () => {
  const ctx = panelContext();
  const picks = [];
  const panel = ctx.AstroPreviewPanel.create({ onPick: (i) => picks.push(i) });
  panel.setSky({ stars: STARS, constellations: CONS, theme: "Realistic" });
  panel.setWidth(W);
  const [ra, dec] = starNamed("Betelgeuse");
  panel.setView({ ra: ra, dec: dec, fov: 60 });
  const draw = panel.widget._items[1];
  const q = P.toPx(panel.view(), ra, dec, draw._size[0], draw._size[1]);
  // The Draw is y-up: its y is the height minus the view's y.
  const pos = { x: q[0], y: draw._size[1] - q[1] };
  draw.onMousePress(pos, "left");
  draw.onMouseRelease(pos, "left");
  assert.deepEqual(picks, [indexNamed(CONS, "Ori")]);
  draw.onMousePress(pos, "left");
  draw.onMouseMove({ x: pos.x + 60, y: pos.y }, "left");
  draw.onMouseRelease({ x: pos.x + 60, y: pos.y }, "left");
  assert.equal(picks.length, 1, "a drag is not a pick");
});

test("the +/- squares zoom the view, and a middle-drag zooms too", () => {
  const ctx = panelContext();
  const panel = ctx.AstroPreviewPanel.create({});
  panel.setSky({ stars: STARS, constellations: CONS, theme: "Realistic" });
  panel.setWidth(W);
  panel.setView({ ra: 84, dec: 0, fov: 100 });
  const draw = panel.widget._items[1];
  const size = draw._size;
  // The + square sits in the bottom right corner; the Draw is y-up, so its middle is 18 px above the bottom.
  const plus = { x: size[0] - 18, y: 18 };
  draw.onMousePress(plus, "left");
  draw.onMouseRelease(plus, "left");
  assert.ok(panel.view().fov < 100, "+ zooms in");
  const before = panel.view().fov;
  draw.onMousePress({ x: 320, y: 180 }, "middle");
  draw.onMouseMove({ x: 320, y: 100 }, "middle");   // y-up, so 100 is lower on screen: out
  draw.onMouseRelease({ x: 320, y: 100 }, "middle");
  assert.ok(panel.view().fov > before, "a middle-drag down zooms out");
});

test("viewFovFor is the inverse of frameCamera: the green frame's camera has the fov it was given, to 0.01 degrees", () => {
  for (const f of [3, 20, 60, 100, 120, 140]) {
    const view = { ra: 10, dec: 5, fov: P.viewFovFor(f) };
    assert.ok(Math.abs(P.frameCamera(view).fov - f) < 0.01, "camera fov " + f);
  }
});
