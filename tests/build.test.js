const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { buildPanel, buildRuntimeSource, ROOT, CAVALRY_FILES } = require("../tools/buildlib.js");

// A minimal in-memory Cavalry stub: settings files, a timer, and nothing else the placeholder panel
// and its update check touch. Later tasks add to it as the panel grows.
function makeFakeApi() {
  const files = Object.create(null);
  const timers = [];
  function Timer(callbacks) { this.callbacks = callbacks; this.active = false; timers.push(this); }
  Timer.prototype.setRepeating = function (r) { this.repeating = !!r; };
  Timer.prototype.setInterval = function (ms) { this.interval = ms; };
  Timer.prototype.start = function () { this.active = true; };
  Timer.prototype.stop = function () { this.active = false; };
  return {
    getAppDataFolder: () => "C:/fake/AppData",
    filePathExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFromFile: (p) => files[p],
    writeToFile: (p, c) => { files[p] = String(c); },
    makeFolder: (p) => { files[p] = files[p] === undefined ? "<dir>" : files[p]; },
    deleteFilePath: (p) => { delete files[p]; },
    Timer: Timer,
    _timers: timers,
    _files: files
  };
}

// A minimal in-memory Cavalry ui: the widgets the placeholder panel and the style kit build.
function makeFakeUi() {
  function Widget(kind) { this.kind = kind; this._items = []; this._layout = null; this._hidden = false; }
  ["setHidden", "setBackgroundColor", "setToolTip", "setFixedWidth", "setFixedHeight", "setFontSize", "setTextColor",
    "setMargins", "setSpaceBetween", "addSpacing", "setRadius", "setBorder", "setDrawStroke", "setImageSize", "setImage"]
    .forEach((m) => { Widget.prototype[m] = function (...args) { this["_" + m] = args; return this; }; });
  Widget.prototype.setHidden = function (h) { this._hidden = !!h; };
  Widget.prototype.isHidden = function () { return this._hidden; };
  Widget.prototype.setBackgroundColor = function (c) { this._background = c; };
  Widget.prototype.setText = function (t) { this._text = t; };
  Widget.prototype.getText = function () { return this._text; };
  Widget.prototype.setLayout = function (l) { this._layout = l; };
  Widget.prototype.add = function (w) { this._items.push(w); };
  Widget.prototype.addStretch = function () { this._stretch = (this._stretch || 0) + 1; };

  function Label(text) { Widget.call(this, "Label"); this._text = text || ""; }
  Label.prototype = Object.create(Widget.prototype);
  function Button(text) { Widget.call(this, "Button"); this._text = text || ""; this.onClick = null; }
  Button.prototype = Object.create(Widget.prototype);
  function Container() { Widget.call(this, "Container"); }
  Container.prototype = Object.create(Widget.prototype);
  Container.prototype.geometry = function () { return { x: 0, y: 0, width: 320, height: 24 }; };
  function VLayout() { Widget.call(this, "VLayout"); }
  VLayout.prototype = Object.create(Widget.prototype);
  function HLayout() { Widget.call(this, "HLayout"); }
  HLayout.prototype = Object.create(Widget.prototype);

  let root = null;
  return {
    Label: Label, Button: Button, Container: Container, VLayout: VLayout, HLayout: HLayout,
    add: function (w) { root = w; },
    show: function () { this._shown = true; },
    setTitle: function (t) { this._title = t; },
    setBackgroundColor: function (c) { this._background = c; },
    _root: function () { return root; }
  };
}

// The scene part of the api (Task 7): layers, attributes, parenting, connections, keyframes, user data and
// the comp. Layers have ids like "javaScriptShape#3"; a connection is [fromId, fromAttr, toId, toAttr].
// readFromFile serves the committed sky data for the CavalryAstro_assets/sky paths, as Cavalry would.
const SKY_FILE = /\/CavalryAstro_assets\/sky\/(stars|constellations)\.json$/;
function addSceneApi(api) {
  const COMP = "comp#1";
  // The comp runs frames 0-100 at 25 fps. Setting endFrame moves frameRange's end, as Cavalry does.
  const store = { [COMP]: { frameRange: { x: 0, y: 100 }, endFrame: 100, playbackEnd: 100, fps: 25 } };
  const names = {}, parents = {}, layers = [], connections = [], keyframes = {}, userData = {}, paints = {}, outFrames = {};
  let nextId = 1, selection = [], frame = 0;
  const ensure = (id) => store[id] || (store[id] = {});
  const layerType = (id) => String(id).split("#")[0];
  const readFile = api.readFromFile;
  Object.assign(api, {
    getActiveComp: () => COMP,
    getLayerType: layerType,
    getNiceName: (id) => names[id] || id,
    create: (type, name) => {
      const id = type + "#" + (nextId++);
      names[id] = name || type;
      if (type === "javaScript") ensure(id)["array.0"] = 0;
      if (type === "javaScriptShape") ensure(id)["generator.array.0"] = 0;
      layers.push(id);
      return id;
    },
    primitive: (kind, name) => api.create("basicShape", name),
    getCompLayers: () => layers.slice(),
    parent: (id, parentId) => { parents[id] = parentId; },
    getParent: (id) => parents[id] || "",
    getChildren: (parentId) => layers.filter((id) => parents[id] === parentId).reverse(),
    hasAttribute: (id, attr) => ensure(id)[attr] !== undefined,
    addDynamic: (id, arr) => {
      const o = ensure(id);
      let n = 0;
      while (o[arr + "." + n] !== undefined) n++;
      o[arr + "." + n] = 0;
      return arr + "." + n;
    },
    renameAttribute: (id, attr, name) => { names[id + "." + attr] = name; },
    set: (id, obj) => {
      Object.keys(obj).forEach((k) => { ensure(id)[k] = JSON.parse(JSON.stringify(obj[k])); });
      if (id === COMP && obj.endFrame !== undefined) ensure(id).frameRange = { x: 0, y: obj.endFrame };
    },
    get: (id, attr) => {
      if (id === COMP && attr === "resolution") return { x: 1920, y: 1080 };
      // A keyed attribute holds its last key at or before the playhead (the first key before any).
      const k = keyframes[id] && keyframes[id][attr];
      if (k && Object.keys(k).length) {
        const times = Object.keys(k).map(Number).sort((a, b) => a - b);
        let at = times[0];
        times.forEach((t) => { if (t <= frame) at = t; });
        return k[at];
      }
      return ensure(id)[attr];
    },
    deleteKeyframe: (id, attr, f) => { if (keyframes[id] && keyframes[id][attr]) delete keyframes[id][attr][f]; },
    getFrame: () => frame,
    setFrame: (f) => { frame = f; },
    getOutFrame: (id) => outFrames[id],
    setOutFrame: (id, f) => { outFrames[id] = f; },
    keyframe: (id, f, obj) => {
      Object.keys(obj).forEach((attr) => {
        keyframes[id] = keyframes[id] || {};
        keyframes[id][attr] = keyframes[id][attr] || {};
        keyframes[id][attr][f] = obj[attr];
      });
    },
    getKeyframeTimes: (id, attr) => {
      const k = keyframes[id] && keyframes[id][attr];
      return k ? Object.keys(k).map(Number).sort((a, b) => a - b) : [];
    },
    connect: (a, b, c, d) => {
      // Like Cavalry: a layer's filters list appends each connection (filters.0, filters.1, ...).
      if (d === "filters") d = "filters." + connections.filter((k) => k[2] === c && /^filters\.\d+$/.test(k[3])).length;
      connections.push([a, b, c, d]);
    },
    getInConnection: (id, attr) => {
      for (let i = connections.length - 1; i >= 0; i--) {
        const k = connections[i];
        if (k[2] === id && k[3] === attr) return k[0] + "." + k[1];
      }
      return "";
    },
    getOutConnections: (id, attr) => connections.filter((k) => k[0] === id && k[1] === attr).map((k) => k[2] + "." + k[3]),
    setFill: (id, on) => { (paints[id] = paints[id] || {}).fill = !!on; },
    setStroke: (id, on) => { (paints[id] = paints[id] || {}).stroke = !!on; },
    select: (id) => { selection = [id]; },
    getSelection: () => selection.slice(),
    setUserData: (id, key, value) => { (userData[id] = userData[id] || {})[key] = JSON.parse(JSON.stringify(value)); },
    getUserDataKey: (id, key) => { const v = (userData[id] || {})[key]; return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    hasUserDataKey: (id, key) => !!userData[id] && Object.prototype.hasOwnProperty.call(userData[id], key),
    readFromFile: (p) => {
      const m = SKY_FILE.exec(String(p));
      return m ? fs.readFileSync(path.join(ROOT, "assets", "sky", m[1] + ".json"), "utf8") : readFile(p);
    },
    _connections: connections,
    _store: store,
    _paints: paints
  });
  return api;
}

// Runs the built panel against the stubs and returns them, as Cavalry would when the script loads.
function runPanel() {
  const api = addSceneApi(makeFakeApi());
  const ui = makeFakeUi();
  const sandbox = { api: api, ui: ui, console: console };
  const context = vm.createContext(sandbox);
  vm.runInContext(buildPanel(), context, { filename: "CavalryAstro.js" });
  return { api: api, ui: ui, context: context };
}

// Every button under `node`, in layout order. Containers keep their content in _layout, layouts in _items.
function buttonsIn(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "Button") out.push(node);
  (node._items || []).forEach((n) => buttonsIn(n, out));
  if (node._layout) buttonsIn(node._layout, out);
  return out;
}

test("the panel bundle compiles and stamps the version", () => {
  const src = buildPanel();
  assert.doesNotThrow(() => new vm.Script(src, { filename: "CavalryAstro.js" }));
  assert.ok(src.includes("var ASTRO_VERSION = "));
  assert.ok(src.includes("ui.show()"));
});

test("the bundle never calls api.processEvents", () => {
  assert.equal(/api\.processEvents\s*\(/.test(buildPanel()), false);
});

test("the panel opens with tabs Sky, Stars, Reveal and a ⚙ button", () => {
  const { ui } = runPanel();
  assert.equal(ui._shown, true, "ui.show() was called");
  assert.equal(ui._title, "CavalryAstro");
  const labels = buttonsIn(ui._root()).map((b) => b._text);
  assert.deepEqual(labels, ["Sky", "Stars", "Reveal", "⚙"]);
});

test("clicking a tab selects it and shows only its page", () => {
  const { ui } = runPanel();
  const [sky, stars] = buttonsIn(ui._root());
  stars.onClick();
  assert.equal(stars._background, "#373737", "the selected tab takes the lighter colour");
  assert.equal(sky._background, "#1c1c1c", "the other tab goes back to the shadow colour");
  const pages = ui._root()._items[1]._items;
  assert.deepEqual(pages.map((p) => p._hidden), [true, false, true]);
});

test("the panel bundle embeds ASTRO_SKY_SRC", () => {
  const src = buildPanel();
  assert.ok(src.includes("var ASTRO_SKY_SRC = " + JSON.stringify(buildRuntimeSource("sky")) + ";"));
  const cavalryStart = src.indexOf(fs.readFileSync(path.join(ROOT, CAVALRY_FILES[0]), "utf8"));
  assert.ok(src.indexOf("var AstroExpression") < src.indexOf("var ASTRO_SKY_SRC = "), "after the core files");
  assert.ok(src.indexOf("var ASTRO_SKY_SRC = ") < cavalryStart, "before the cavalry files");
});

// ---- The sky (Task 7) -------------------------------------------------------------------------------
const E = require("../src/core/expression.js");
const SKY_CAM = { ra: 83.8, dec: 0, fov: 60, rotation: 0, projection: 0 };

// A panel run with a sky made in it: the scene, the sky and its layers (by part).
function skyFixture(theme) {
  const { api, context } = runPanel();
  const S = context.AstroScene;
  const sky = S.createSky("Sky 1", SKY_CAM, theme || "Realistic");
  return { api: api, S: S, sky: sky, layers: S.skyLayers(sky), context: context };
}

// The ASTRO_DATA object embedded in a sky layer's expression.
function embeddedData(api, id) {
  const expr = String(api.get(id, "generator.expression"));
  const open = expr.indexOf("var ASTRO_DATA = ") + "var ASTRO_DATA = ".length;
  return JSON.parse(expr.slice(open, expr.indexOf(";/*ASTRO_DATA_END*/")));
}

test("createSky makes one group holding a Camera, a background, star bands, a glow, lines, borders and names", () => {
  const { api, sky, layers } = skyFixture();
  assert.equal(api.getLayerType(sky.groupId), "group");
  assert.equal(api.getNiceName(sky.groupId), "Sky 1");
  assert.equal(api.getLayerType(sky.cameraId), "javaScript");
  assert.equal(api.getNiceName(sky.cameraId), "Camera");
  assert.ok(layers.background, "a background");
  assert.ok(layers.bands.length >= 5, "at least five star bands");
  ["glow", "lines", "borders", "names"].forEach((k) => assert.ok(layers[k], k));
  // Camera, background, the bands, the glow and its blur filter, lines, borders, names.
  assert.equal(api.getChildren(sky.groupId).length, layers.bands.length + 7);
});

test("the sky stacks from the bottom: camera, background, borders, lines, glow, stars, names", () => {
  const { api, sky, layers } = skyFixture();
  const bottomUp = api.getChildren(sky.groupId).slice().reverse().map((id) => api.getNiceName(id));
  const bands = layers.bands.map((id) => api.getNiceName(id));
  const expected = ["Camera", "Sky background", "Constellation borders", "Constellation lines", "Star glow", "Star glow blur"]
    .concat(bands, ["Constellation names"]);
  assert.deepEqual(bottomUp, expected);
});

test("createSky selects the sky group", () => {
  const { api, sky } = skyFixture();
  assert.deepEqual(api.getSelection(), [sky.groupId]);
});

test("every layer that draws the sky takes its camera inputs from the Camera utility", () => {
  const { api, sky, layers } = skyFixture();
  layers.bands.concat([layers.glow, layers.lines, layers.borders, layers.names]).forEach((id) => {
    for (let i = 0; i < 5; i++) {
      assert.equal(api.getInConnection(id, "generator.array." + i), sky.cameraId + ".array." + i, api.getNiceName(id) + " input " + i);
    }
  });
});

test("the borders and names start hidden, the lines do not", () => {
  const { api, layers } = skyFixture();
  assert.equal(api.get(layers.borders, "hidden"), true);
  assert.equal(api.get(layers.names, "hidden"), true);
  assert.notEqual(api.get(layers.lines, "hidden"), true);
});

test("findSkies finds the sky by its user data", () => {
  const { S, sky } = skyFixture();
  const found = S.findSkies();
  assert.equal(found.length, 1);
  assert.equal(found[0].groupId, sky.groupId);
  assert.equal(found[0].cameraId, sky.cameraId);
  assert.equal(found[0].name, "Sky 1");
});

test("setDarkness sets the darkness input of every star layer", () => {
  const { api, S, sky, layers } = skyFixture();
  S.setDarkness(sky, 0);
  const idx = E.inputIndex(E.STAR_INPUTS, "darkness");
  layers.bands.concat([layers.glow]).forEach((id) => {
    assert.equal(api.get(id, "generator.array." + idx), 0, api.getNiceName(id));
  });
});

test("applyTheme with Mono makes every band the same colour", () => {
  const { api, S, sky, layers } = skyFixture();
  S.applyTheme(sky, "Mono");
  const fills = new Set(layers.bands.map((id) => api.get(id, "material.materialColor")));
  assert.equal(fills.size, 1);
});

test("a glow turned off stays off through star colour changes and theme changes", () => {
  const { api, S, sky, layers } = skyFixture();
  const full = 0.6 * 100;   // Realistic's glow
  assert.equal(api.get(layers.glow, "opacity"), full, "on by default");
  S.setGlow(sky, false);
  assert.equal(api.get(layers.glow, "opacity"), 0);
  S.setStarColours(sky, true);
  assert.equal(api.get(layers.glow, "opacity"), 0, "star colours do not turn the glow back on");
  S.applyTheme(sky, "Mono");
  assert.equal(api.get(layers.glow, "opacity"), 0, "a theme change does not turn the glow back on");
  S.setGlow(sky, true);
  assert.equal(api.get(layers.glow, "opacity"), 0.2 * 100, "Mono's glow, restored");
});

test("applyTheme leaves an animated lines colour alone and counts it as skipped", () => {
  const { api, S, sky, layers } = skyFixture();
  api.keyframe(layers.lines, 0, { "stroke.strokeColor": "#ff0000" });
  const r = S.applyTheme(sky, "Mono");
  assert.equal(api.get(layers.lines, "stroke.strokeColor"), "#ff0000");
  assert.ok(r.skipped >= 1, "skipped counts the animated colour");
  assert.ok(r.changed > 0, "the rest of the sky is changed");
});

test("each band embeds only its own stars, and the glow embeds the stars brighter than magnitude 2.5", () => {
  const { api, layers } = skyFixture();
  const rows = require("../assets/sky/stars.json").rows;
  const counted = layers.bands.reduce((n, id) => n + embeddedData(api, id).mag.length, 0);
  assert.equal(counted, rows.length, "every star is in exactly one band");
  const glow = embeddedData(api, layers.glow);
  assert.equal(glow.mag.length, rows.filter((r) => r[2] < 2.5).length);
  assert.ok(glow.mag.every((m) => m < 2.5));
});

// ---- Camera moves (Task 8) --------------------------------------------------------------------------
// The constellation index of a name in the bundled catalogue (the scene's own index).
function consIndex(context, name) {
  const cons = context.AstroCatalog.decodeConstellations(require("../assets/sky/constellations.json"));
  return context.AstroCatalog.findConstellation(cons, name);
}

test("flying to Orion from frame 0 to 100 keys frames 0 to 100 and ends on Orion's centre", () => {
  const { api, S, sky } = skyFixture();
  const orion = S.flyTarget("constellation", consIndex(skyFixture().context, "Orion"));
  assert.equal(S.lastFlight(sky), null, "no flight yet");
  S.flyTo(sky, orion, { start: 0, end: 100, easing: "smooth", arc: "normal" });
  assert.deepEqual(api.getKeyframeTimes(sky.cameraId, "array.0"), Array.from({ length: 101 }, (_, i) => i));
  const end = S.readCameraAt(sky, 100);
  assert.ok(Math.abs(end.ra - orion.ra) < 1e-9 && Math.abs(end.dec - orion.dec) < 1e-9, "ends on Orion's centre");
  assert.equal(end.fov, orion.fov);
  assert.ok(end.fov >= 8 && end.fov <= 120, "fov in [8, 120]");
});

test("lastFlight returns the record of the latest flight", () => {
  const { S, sky, context } = skyFixture();
  S.flyTo(sky, S.flyTarget("constellation", consIndex(context, "Orion")), { start: 0, end: 50, easing: "smooth", arc: "normal" });
  S.flyTo(sky, S.flyTarget("constellation", consIndex(context, "Andromeda")), { start: 60, end: 100, easing: "gentle", arc: "low" });
  const last = S.lastFlight(sky);
  assert.equal(last.target.label, "Andromeda");
  assert.equal(last.start, 60);
  assert.equal(last.easing, "gentle");
});

test("a flight from Andromeda to Pisces keys no two consecutive centreRa values more than 10 apart", () => {
  const { S, sky, context } = skyFixture();
  S.jumpCamera(sky, S.flyTarget("constellation", consIndex(context, "Andromeda")));
  const pisces = S.flyTarget("constellation", consIndex(context, "Psc"));
  S.flyTo(sky, pisces, { start: 0, end: 100, easing: "smooth", arc: "normal" });
  const ras = [];
  for (let f = 0; f <= 100; f++) ras.push(S.readCameraAt(sky, f).ra);
  for (let f = 1; f < ras.length; f++) assert.ok(Math.abs(ras[f] - ras[f - 1]) < 10, "frame " + f);
  assert.ok(Math.abs(ras[0] - 10) < 10, "the first key is near Andromeda's RA");
});

test("recording a flight over the same frames replaces its record and keeps its place in the order", () => {
  const { api, S, sky, context } = skyFixture();
  const rec = (start, end, name) => ({ start, end, from: { ra: 0, dec: 0, fov: 60 }, to: { ra: 1, dec: 1, fov: 20 },
    target: { kind: "constellation", index: 0, label: name, ra: 1, dec: 1, fov: 20 }, easing: "smooth", arc: "normal" });
  S.recordFlight(sky, rec(0, 50, "first"));
  S.recordFlight(sky, rec(60, 100, "second"));
  S.recordFlight(sky, rec(0, 50, "first again"));
  const stored = api.getUserDataKey(sky.cameraId, "astroFlights");
  assert.deepEqual(stored.map((r) => r.target.label), ["first again", "second"]);
  assert.equal(S.lastFlight(sky).target.label, "second");
});

test("flightAt finds the latest flight covering a frame, and none outside every flight", () => {
  const { S, sky, context } = skyFixture();
  S.flyTo(sky, S.flyTarget("constellation", consIndex(context, "Orion")), { start: 0, end: 100, easing: "smooth", arc: "normal" });
  assert.equal(S.flightAt(sky, 50).target.label, "Orion");
  assert.equal(S.flightAt(sky, 150), null);
});

test("extendComp lengthens the comp to the new end plus 3 seconds and moves the layers that reached the old end", () => {
  const { api, S, sky, layers } = skyFixture();
  const comp = api.getActiveComp();
  api.setOutFrame(layers.lines, 100);
  api.setOutFrame(layers.names, 50);
  S.extendComp(250);
  assert.equal(api.get(comp, "endFrame"), 250 + 3 * 25, "end = new end + 3 s at 25 fps");
  assert.equal(api.get(comp, "playbackEnd"), 250 + 3 * 25, "the play range followed the old end");
  assert.equal(api.getOutFrame(layers.lines), 250 + 3 * 25 + 1, "a layer that reached the old end follows");
  assert.equal(api.getOutFrame(layers.names), 50, "a layer trimmed earlier is left alone");
});

test("the fly target frames a constellation on its border and a star at fov 20", () => {
  const { S, context } = skyFixture();
  const cons = context.AstroCatalog.decodeConstellations(require("../assets/sky/constellations.json"));
  const ser = cons[consIndex(context, "Ser")];
  let far = 0;
  ser.border.forEach((ring) => ring.forEach((p) => {
    far = Math.max(far, context.AstroSky.angularDistance(ser.centre[0], ser.centre[1], p[0], p[1]));
  }));
  const target = S.flyTarget("constellation", consIndex(context, "Ser"));
  assert.ok(Math.abs(target.fov - Math.min(120, Math.max(8, far * 2 * 1.4))) < 1e-9, "2 x 1.4 x the farthest border point");
  assert.equal(target.ra, ser.centre[0]);
  assert.equal(target.dec, ser.centre[1]);
  const star = S.flyTarget("star", 0);
  assert.equal(star.fov, 20);
  assert.equal(star.ra, require("../assets/sky/stars.json").rows[0][0]);
});

test("jumpCamera sets the camera's centre and field of view", () => {
  const { S, sky } = skyFixture();
  S.jumpCamera(sky, { ra: 10, dec: 37, fov: 30 });
  const cam = S.readCamera(sky);
  assert.equal(cam.ra, 10);
  assert.equal(cam.dec, 37);
  assert.equal(cam.fov, 30);
});
