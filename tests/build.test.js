const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { buildPanel, buildRuntimeSource, ROOT, CAVALRY_FILES, RUNTIMES } = require("../tools/buildlib.js");

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
    // A folder listing: the full paths of the files directly in dir (the Sky styles folder reads its .json files).
    listDirectoryPaths: (dir) => Object.keys(files).filter((p) => p.startsWith(dir + "/") && p.slice(dir.length + 1).indexOf("/") < 0),
    Timer: Timer,
    _timers: timers,
    _files: files
  };
}

// A minimal in-memory Cavalry ui: the widgets the placeholder panel and the style kit build.
function makeFakeUi() {
  const all = []; // every widget made, so a test can check every control (popover settings included)
  function Widget(kind) { this.kind = kind; this._items = []; this._layout = null; this._hidden = false; all.push(this); }
  ["setHidden", "setBackgroundColor", "setToolTip", "setFixedWidth", "setFixedHeight", "setFontSize", "setTextColor",
    "setMargins", "setSpaceBetween", "addSpacing", "setRadius", "setBorder", "setDrawStroke", "setImageSize", "setImage"]
    .forEach((m) => { Widget.prototype[m] = function (...args) { this["_" + m] = args; return this; }; });
  Widget.prototype.setHidden = function (h) { this._hidden = !!h; };
  Widget.prototype.isHidden = function () { return this._hidden; };
  Widget.prototype.setBackgroundColor = function (c) { this._background = c; };
  Widget.prototype.setText = function (t) { this._text = t; };
  Widget.prototype.getText = function () { return this._text; };
  Widget.prototype.setLayout = function (l) { this._layout = l; };
  // Where the widget sits in the window (the cog's popover opens from its bottom middle, as cog.js reads it).
  Widget.prototype.geometry = function () { return { x: 0, y: 0, width: 22, height: 24 }; };
  Widget.prototype.add = function (w) { this._items.push(w); };
  Widget.prototype.addStretch = function () { this._stretch = (this._stretch || 0) + 1; };

  function Label(text) { Widget.call(this, "Label"); this._text = text || ""; }
  Label.prototype = Object.create(Widget.prototype);
  function Button(text) { Widget.call(this, "Button"); this._text = text || ""; this.onClick = null; }
  Button.prototype = Object.create(Widget.prototype);
  function Container() { Widget.call(this, "Container"); }
  Container.prototype = Object.create(Widget.prototype);
  Container.prototype.geometry = function () { return { x: 0, y: 0, width: 320, height: 24 }; };
  Container.prototype.showAsPopover = function (x, y) { this._popover = [x, y]; };
  // The Cavalry input widgets the panel uses. Entries and values are kept as set; a test fires onValueChanged itself.
  function DropDown() { Widget.call(this, "DropDown"); this._entries = []; this._value = 0; this.onValueChanged = null; }
  DropDown.prototype = Object.create(Widget.prototype);
  DropDown.prototype.addEntry = function (t) { this._entries.push(String(t)); };
  DropDown.prototype.clear = function () { this._entries = []; };
  DropDown.prototype.getValue = function () { return this._value; };
  DropDown.prototype.setValue = function (i) { this._value = i; };
  function LineEdit() { Widget.call(this, "LineEdit"); this._text = ""; this.onValueCommitted = null; }
  LineEdit.prototype = Object.create(Widget.prototype);
  LineEdit.prototype.getText = function () { return this._text; };
  LineEdit.prototype.setText = function (t) { this._text = String(t); };
  LineEdit.prototype.setPlaceholder = function (t) { this._placeholder = t; };
  function NumericField(v) { Widget.call(this, "NumericField"); this._value = Number(v) || 0; }
  NumericField.prototype = Object.create(Widget.prototype);
  NumericField.prototype.getValue = function () { return this._value; };
  NumericField.prototype.setValue = function (v) { this._value = Number(v); };
  NumericField.prototype.setType = function (t) { this._type = t; };
  NumericField.prototype.setMin = function (v) { this._min = v; };
  NumericField.prototype.setMax = function (v) { this._max = v; };
  function Checkbox(on) { Widget.call(this, "Checkbox"); this._value = !!on; }
  Checkbox.prototype = Object.create(Widget.prototype);
  Checkbox.prototype.getValue = function () { return this._value; };
  Checkbox.prototype.setValue = function (v) { this._value = !!v; };
  // ui.Modal: showQuestion returns the test's answer (modal.answer) and keeps each question asked.
  const modal = { answer: true, asked: [] };
  function Modal() { this.kind = "Modal"; }
  Modal.prototype.showQuestion = function (title, text) { modal.asked.push({ title: title, text: String(text) }); return modal.answer; };
  function VLayout() { Widget.call(this, "VLayout"); }
  VLayout.prototype = Object.create(Widget.prototype);
  function HLayout() { Widget.call(this, "HLayout"); }
  HLayout.prototype = Object.create(Widget.prototype);
  // Like Cavalry's Draw: paths are recorded and a test fires the mouse callbacks itself (the sky preview, Task 11).
  function Draw() { Widget.call(this, "Draw"); this._paths = []; this._size = [0, 0]; this._redraws = 0; }
  Draw.prototype = Object.create(Widget.prototype);
  Draw.prototype.setSize = function (w, h) { this._size = [w, h]; };
  Draw.prototype.setMinimumWidth = function (w) { this._minW = w; };
  Draw.prototype.setMinimumHeight = function (h) { this._minH = h; };
  Draw.prototype.addPath = function (p, paint) { this._paths.push({ path: p, paint: paint }); };
  Draw.prototype.clearPaths = function () { this._paths = []; };
  Draw.prototype.redraw = function () { this._redraws++; };
  Draw.prototype.useHoverEvents = function (on) { this._hover = !!on; };
  // Cavalry's ui.Slider (setRange, getValue, setValue, onValueChanged) and ui.List (rows by uuid, onSelectionChanged).
  function Slider() { Widget.call(this, "Slider"); this._value = 0; this._range = [0, 100]; this.onValueChanged = null; }
  Slider.prototype = Object.create(Widget.prototype);
  Slider.prototype.getValue = function () { return this._value; };
  Slider.prototype.setValue = function (v) { this._value = Number(v); };
  Slider.prototype.setRange = function (lo, hi) { this._range = [lo, hi]; };
  function List() { Widget.call(this, "List"); this._model = []; this._selection = []; this.onSelectionChanged = null; }
  List.prototype = Object.create(Widget.prototype);
  List.prototype.setSelectionMode = function (m) { this._mode = m; };
  List.prototype.setModel = function (m) { this._model = m.slice(); };
  List.prototype.getModel = function () { return this._model.slice(); };
  List.prototype.getSelection = function () { return this._selection.slice(); };
  // A click that selects these rows: the selection is set and the change callback fires, as Cavalry does.
  List.prototype.pick = function (uuids) {
    this._selection = uuids.slice();
    if (typeof this.onSelectionChanged === "function") this.onSelectionChanged(this.getSelection());
  };

  let root = null;
  return {
    Label: Label, Button: Button, Container: Container, VLayout: VLayout, HLayout: HLayout, Draw: Draw,
    DropDown: DropDown, LineEdit: LineEdit, NumericField: NumericField, Checkbox: Checkbox, Modal: Modal,
    Slider: Slider, List: List,
    add: function (w) { root = w; },
    show: function () { this._shown = true; },
    setTitle: function (t) { this._title = t; },
    setBackgroundColor: function (c) { this._background = c; },
    _root: function () { return root; },
    _all: function () { return all.slice(); },
    _modal: modal
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
  // A component's promoted attributes: { src: "layer.attr", name, notes } in list order (Cavalry's promotedAttributes).
  const promos = {};
  const promoRef = (k) => /^promotedAttributes\.(\d+)\.(name|notes)$/.exec(String(k));
  // The [layer, attr] an input is connected from (the latest connection), or null.
  const sourceOf = (id, attr) => {
    for (let i = connections.length - 1; i >= 0; i--) {
      if (connections[i][2] === id && connections[i][3] === attr) return [connections[i][0], connections[i][1]];
    }
    return null;
  };
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
    deleteLayer: (id) => {
      const gone = [id];
      for (let i = 0; i < gone.length; i++) layers.filter((c) => parents[c] === gone[i]).forEach((c) => gone.push(c));
      gone.forEach((g) => { const k = layers.indexOf(g); if (k >= 0) layers.splice(k, 1); delete parents[g]; });
      for (let i = connections.length - 1; i >= 0; i--) {
        if (gone.includes(connections[i][0]) || gone.includes(connections[i][2])) connections.splice(i, 1);
      }
    },
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
      Object.keys(obj).forEach((k) => {
        const m = promoRef(k);
        if (m && promos[id]) { promos[id][Number(m[1])][m[2]] = obj[k]; return; }
        ensure(id)[k] = JSON.parse(JSON.stringify(obj[k]));
      });
      if (id === COMP && obj.endFrame !== undefined) ensure(id).frameRange = { x: 0, y: obj.endFrame };
    },
    get: (id, attr) => {
      if (id === COMP && attr === "resolution") return { x: 1920, y: 1080 };
      const pm = promoRef(attr);
      if (pm && promos[id] && promos[id][Number(pm[1])]) return promos[id][Number(pm[1])][pm[2]];
      // Like Cavalry: an input fed by a utility's array output reads that output's value, not its own.
      const fed = sourceOf(id, attr);
      if (fed && /^array\.\d+$/.test(fed[1])) return api.get(fed[0], fed[1]);
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
      // Like Cavalry: a component's promotions list appends each promoted attribute.
      if (d === "promotedAttributes") { (promos[c] = promos[c] || []).push({ src: a + "." + b, name: "", notes: "" }); return; }
      // Like Cavalry: a layer's filters list appends each connection (filters.0, filters.1, ...).
      if (d === "filters") d = "filters." + connections.filter((k) => k[2] === c && /^filters\.\d+$/.test(k[3])).length;
      connections.push([a, b, c, d]);
    },
    disconnect: (a, b, c, d) => {
      for (let i = connections.length - 1; i >= 0; i--) {
        const k = connections[i];
        if (k[0] === a && k[1] === b && k[2] === c && k[3] === d) connections.splice(i, 1);
      }
    },
    getInConnection: (id, attr) => {
      const pm = /^promotedAttributes\.(\d+)\.attribute$/.exec(attr);
      if (pm) return promos[id] && promos[id][Number(pm[1])] ? promos[id][Number(pm[1])].src : "";
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
    getInConnectedAttributes: (id) => (promos[id] || []).map((p, i) => "promotedAttributes." + i + ".attribute")
      .concat(connections.filter((k) => k[2] === id).map((k) => k[3])),
    removeArrayIndex: (id, path) => {
      const m = /^promotedAttributes\.(\d+)$/.exec(path);
      if (m && promos[id]) promos[id].splice(Number(m[1]), 1);
    },
    getCustomAttributeName: (id, attr) => names[id + "." + attr] || attr,
    _promoted: (id) => (promos[id] || []).map((p) => p.src),
    _connections: connections,
    _store: store,
    _paints: paints
  });
  // Cavalry returns a material or stroke colour as {r, g, b, a}, not a hex string (Geo's verified API notes). The fake
  // does the same, so the code under test meets the real shape: a hex value written is read back as an object.
  const COLOUR_ATTRS = ["material.materialColor", "stroke.strokeColor"];
  const plainGet = api.get;
  api.get = (id, attr) => {
    const v = plainGet(id, attr);
    if (COLOUR_ATTRS.indexOf(attr) >= 0 && typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) {
      return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 255 };
    }
    return v;
  };
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
  // The tab bar and the ⚙ cog are the first row; the pages (and the Sky page's buttons) come after it.
  const labels = buttonsIn(ui._root()._items[0]).map((b) => b._text);
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

test("the panel bundle carries the sky preview: AstroPreview as core, AstroPreviewPanel before panel.js", () => {
  const src = buildPanel();
  assert.ok(src.includes("var AstroPreview = (function"), "preview.js is in the core files");
  assert.ok(src.indexOf("var AstroPreview = (function") < src.indexOf("var ASTRO_SKY_SRC = "), "after the sky core files");
  const panelStart = src.indexOf(fs.readFileSync(path.join(ROOT, "src/cavalry/panel.js"), "utf8"));
  assert.ok(src.indexOf("var AstroPreviewPanel = (function") < panelStart, "before panel.js");
});

test("the panel bundle embeds ASTRO_SKY_SRC", () => {
  const src = buildPanel();
  assert.ok(src.includes("var ASTRO_SKY_SRC = " + JSON.stringify(buildRuntimeSource("sky")) + ";"));
  const cavalryStart = src.indexOf(fs.readFileSync(path.join(ROOT, CAVALRY_FILES[0]), "utf8"));
  assert.ok(src.indexOf("var AstroExpression") < src.indexOf("var ASTRO_SKY_SRC = "), "after the core files");
  assert.ok(src.indexOf("var ASTRO_SKY_SRC = ") < cavalryStart, "before the cavalry files");
});

test("the panel bundle embeds ASTRO_REVEAL_SRC: the sky maths and the reveal maths, and carries reveal.js as core", () => {
  const src = buildPanel();
  assert.ok(src.includes("var ASTRO_REVEAL_SRC = " + JSON.stringify(buildRuntimeSource("reveal")) + ";"));
  assert.deepEqual(RUNTIMES.reveal, ["src/core/sky.js", "src/core/reveal.js"]);
  assert.ok(src.includes("var AstroReveal = (function"), "reveal.js is in the core files");
  assert.ok(src.indexOf("var AstroReveal = (function") < src.indexOf("var ASTRO_REVEAL_SRC = "));
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
  assert.equal(api.getChildren(sky.groupId).length, layers.bands.length + 8);
});

test("the sky stacks from the bottom: camera, background, borders, lines, glow, stars, names", () => {
  const { api, sky, layers } = skyFixture();
  const bottomUp = api.getChildren(sky.groupId).slice().reverse().map((id) => api.getNiceName(id));
  const bands = layers.bands.map((id) => api.getNiceName(id));
  const expected = ["Camera", "Sky background", "Constellation borders", "Constellation lines", "Star glow", "Star glow blur", "Star glow opacity"]
    .concat(bands, ["Constellation names"]);
  assert.deepEqual(bottomUp, expected);
});

test("createSky selects the \"<sky> Sky controls\" layer, not the group", () => {
  const { api, sky } = skyFixture();
  const comp = api.getCompLayers(false).find((id) => api.getNiceName(id) === "Sky 1 Sky controls");
  assert.ok(comp, "the controls component");
  assert.deepEqual(api.getSelection(), [comp]);
  assert.notEqual(api.getSelection()[0], sky.groupId);
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
  const fills = new Set(layers.bands.map((id) => JSON.stringify(api.get(id, "material.materialColor"))));
  assert.equal(fills.size, 1);
});

test("a glow turned off stays off through star colour changes and theme changes", () => {
  const { api, S, sky, layers } = skyFixture();
  const full = 0.6 * 100;   // Realistic's glow
  // The glow's opacity is driven by the Star glow opacity utility, whose level input holds the glow level.
  const level = () => api.get(layers.glowLevel, "array.1");
  assert.equal(api.getInConnection(layers.glow, "opacity"), layers.glowLevel + ".id", "the glow opacity is driven");
  assert.equal(level(), full, "on by default");
  S.setGlow(sky, false);
  assert.equal(level(), 0);
  S.setStarColours(sky, true);
  assert.equal(level(), 0, "star colours do not turn the glow back on");
  S.applyTheme(sky, "Mono");
  assert.equal(level(), 0, "a theme change does not turn the glow back on");
  S.setGlow(sky, true);
  assert.equal(level(), 0.2 * 100, "Mono's glow, restored");
});

test("applyTheme leaves an animated lines colour alone and counts it as skipped", () => {
  const { api, S, sky, layers } = skyFixture();
  api.keyframe(layers.lines, 0, { "stroke.strokeColor": "#ff0000" });
  const r = S.applyTheme(sky, "Mono");
  assert.deepEqual(api.get(layers.lines, "stroke.strokeColor"), { r: 255, g: 0, b: 0, a: 255 }, "Cavalry shape: {r, g, b, a}");
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

// ---- Reveals and spotlight (Task 9) ------------------------------------------------------------------
const REVEAL_PARTS = ["lines", "border", "title", "labels"];

// A sky with Orion revealed over frames 10 to 35 with every part, and the reveal.
function revealFixture() {
  const f = skyFixture();
  const orion = consIndex(f.context, "Orion");
  const reveal = f.S.createReveal(f.sky, orion, REVEAL_PARTS, 10, 25, { titleMode: 0 });
  return Object.assign(f, { orion: orion, reveal: reveal });
}
// The children of a group by nice name, and the child with a name.
function namesIn(api, groupId) { return api.getChildren(groupId).map((id) => api.getNiceName(id)); }
function childNamed(api, groupId, name) { return api.getChildren(groupId).filter((id) => api.getNiceName(id) === name)[0]; }

test("createReveal makes Reveal 1: Orion inside the sky, with its amount keyed 0 at the start and 100 at the end", () => {
  const { api, S, sky, reveal } = revealFixture();
  assert.equal(api.getNiceName(reveal.groupId), "Reveal 1: Orion");
  assert.equal(reveal.number, 1);
  assert.equal(api.getParent(reveal.groupId), sky.groupId);
  const amount = S.findReveals(sky)[0].amountId;
  assert.deepEqual(api.getKeyframeTimes(amount, "array.0"), [10, 35]);
  assert.equal(api.get(amount, "array.0"), 0);
});

test("createReveal makes the members: the amount, the staged utilities, lines, border with a blur copy, bands, labels and title", () => {
  const { api, reveal } = revealFixture();
  const names = namesIn(api, reveal.groupId);
  ["Reveal amount", "Reveal border opacity", "Reveal lines draw", "Reveal labels opacity", "Reveal title opacity",
    "Reveal title position", "Reveal lines", "Reveal border", "Reveal border glow", "Reveal labels", "Title"]
    .forEach((n) => assert.ok(names.indexOf(n) >= 0, n));
  assert.ok(names.some((n) => /^Reveal stars · band \d$/.test(n)), "a reveal star layer per band present");
  const title = childNamed(api, reveal.groupId, "Title");
  assert.equal(api.getLayerType(title), "textShape");
  assert.equal(api.get(title, "text"), "Orion", "Realistic writes names in title case");
});

test("the reveal star layers ignore the darkness limit", () => {
  const { api, reveal } = revealFixture();
  const star = api.getChildren(reveal.groupId).filter((id) => /^Reveal stars/.test(api.getNiceName(id)))[0];
  assert.ok(String(api.get(star, "generator.expression")).indexOf("ignoreLimit: true") >= 0);
});

test("a second reveal of Orion is Reveal 2: Orion", () => {
  const { S, sky, orion } = revealFixture();
  const second = S.createReveal(sky, orion, ["lines"], 50, 25, {});
  assert.equal(second.number, 2);
  assert.equal(S.findReveals(sky).map((r) => r.number).join(","), "1,2");
});

test("the lines draw is fed by the lines stage, and every stage reads the one amount", () => {
  const { api, S, sky, reveal } = revealFixture();
  const amount = S.findReveals(sky)[0].amountId;
  const draw = childNamed(api, reveal.groupId, "Reveal lines draw");
  const lines = childNamed(api, reveal.groupId, "Reveal lines");
  assert.equal(api.getInConnection(lines, "generator.array." + E.inputIndex(E.LINE_INPUTS, "draw")), draw + ".id");
  assert.equal(api.getInConnection(draw, "array.0"), amount + ".array.0");
  const border = childNamed(api, reveal.groupId, "Reveal border");
  assert.equal(api.getInConnection(border, "opacity"), childNamed(api, reveal.groupId, "Reveal border opacity") + ".id");
});

test("the whole-sky lines, borders, names, bands and the glow level are driven by the Spotlight output", () => {
  const { api, sky, layers } = revealFixture();
  const spot = childNamed(api, sky.groupId, "Spotlight");
  assert.ok(spot, "a Spotlight utility in the sky group");
  ["lines", "borders", "names"].forEach((k) => assert.equal(api.getInConnection(layers[k], "opacity"), spot + ".id", k));
  layers.bands.forEach((id) => assert.equal(api.getInConnection(id, "opacity"), spot + ".id"));
  assert.equal(api.getInConnection(layers.glowLevel, "array.0"), spot + ".id", "the glow scales by the same spotlight");
});

test("after deleting Reveal 1, prepareReveals returns 1, Reveal 2 keeps its number, and the Spotlight has only Reveal 2's inputs", () => {
  const { api, S, sky, orion, reveal } = revealFixture();
  const second = S.createReveal(sky, orion, ["lines"], 50, 25, {});
  api.deleteLayer(reveal.groupId);
  assert.equal(S.prepareReveals(sky), 1);
  assert.equal(api.getNiceName(second.groupId), "Reveal 2: Orion", "numbers are not compacted, as in Geo");
  const spot = childNamed(api, sky.groupId, "Spotlight");
  const amount2 = S.findReveals(sky)[0].amountId;
  assert.equal(api.getInConnection(spot, "array.0"), amount2 + ".array.0", "the amount of Reveal 2");
  assert.equal(api.getInConnection(spot, "array.1"), amount2 + ".array.1", "the spotlight of Reveal 2");
  assert.equal(api.hasAttribute(spot, "array.2"), false, "no input for the deleted reveal");
});

test("changeReveal dropping the title removes the Title layer, keeps the amount keys and the number", () => {
  const { api, S, sky, reveal } = revealFixture();
  const amount = S.findReveals(sky)[0].amountId;
  S.changeReveal(reveal.groupId, ["lines", "border", "labels"], {});
  assert.equal(childNamed(api, reveal.groupId, "Title"), undefined);
  assert.equal(api.getNiceName(reveal.groupId), "Reveal 1: Orion");
  assert.deepEqual(api.getKeyframeTimes(amount, "array.0"), [10, 35]);
  assert.ok(childNamed(api, reveal.groupId, "Reveal labels"), "the labels stay");
});

// The utility expressions run in the panel's context: their inputs are the globals named by each input.
function runUtility(context, expr, values) {
  Object.assign(context, values);
  return vm.runInContext(expr, context);
}

test("the Spotlight expression dims the sky by the largest reveal spotlight, scaled by the border stage", () => {
  const { api, sky, context } = revealFixture();
  const expr = String(api.get(childNamed(api, sky.groupId, "Spotlight"), "expression"));
  assert.equal(runUtility(context, expr, { amount0: 0, spotlight0: 60 }), 100, "nothing revealed: no dim");
  assert.equal(runUtility(context, expr, { amount0: 100, spotlight0: 60 }), 40, "fully revealed: 100 - 60");
  assert.equal(runUtility(context, expr, { amount0: 20, spotlight0: 90 }), 55, "half the border stage: 100 - 45");
});

test("the stage expressions give the part's value from the amount: a percentage for opacity, 0 to 1 for draw", () => {
  const { api, reveal, context } = revealFixture();
  const stageExpr = (name) => String(api.get(childNamed(api, reveal.groupId, name), "expression"));
  assert.equal(runUtility(context, stageExpr("Reveal border opacity"), { amount: 45 }), 100, "border done by 40");
  assert.equal(runUtility(context, stageExpr("Reveal labels opacity"), { amount: 70 }), 50, "labels half way");
  assert.equal(runUtility(context, stageExpr("Reveal title opacity"), { amount: 75 }), 0, "title starts at 75");
  assert.equal(runUtility(context, stageExpr("Reveal lines draw"), { amount: 45 }), 0.5, "lines half way");
});

test("the title position expression puts a header title top-centre, and follows the constellation when asked", () => {
  const { api, reveal, context } = revealFixture();
  const expr = String(api.get(childNamed(api, reveal.groupId, "Reveal title position"), "expression"));
  const header = { titleMode: 0, corner: 1, margin: 60, offsetY: 80, conRa: 83, conDec: 6, camRa: 83, camDec: 6, camFov: 60, camRotation: 0, compW: 1920, compH: 1080 };
  assert.deepEqual([...runUtility(context, expr, header)], [0, 480]);
  const follows = Object.assign({}, header, { titleMode: 1 });
  const p = runUtility(context, expr, follows);
  assert.ok(Math.abs(p[0]) < 1 && Math.abs(p[1] - 80) < 1, "the centre of the view, lifted by offsetY: " + p);
});

// A reveal whose amount utility was deleted by hand is broken: the sky must still be connected to a Spotlight.
test("deleting a reveal's amount by hand: prepareReveals removes the broken reveal and reconnects the sky to the Spotlight", () => {
  const { api, S, sky, layers, reveal } = revealFixture();
  api.deleteLayer(S.findReveals(sky)[0].amountId);
  assert.equal(S.prepareReveals(sky), 1);
  assert.equal(api.getLayerType(reveal.groupId) === "group" && api.getChildren(sky.groupId).indexOf(reveal.groupId), -1, "the broken group is gone");
  const spot = childNamed(api, sky.groupId, "Spotlight");
  assert.equal(api.getInConnection(layers.lines, "opacity"), spot + ".id", "the lines follow the new Spotlight");
});

test("after a second createReveal the sky's layers are driven by the NEW Spotlight, and there is one Spotlight", () => {
  const { api, S, sky, layers, orion } = revealFixture();
  api.deleteLayer(S.findReveals(sky)[0].amountId);
  S.prepareReveals(sky);
  S.createReveal(sky, orion, ["lines"], 50, 25, {});
  const spots = api.getChildren(sky.groupId).filter((id) => api.getNiceName(id) === "Spotlight");
  assert.equal(spots.length, 1, "exactly one Spotlight child");
  assert.equal(api.getInConnection(layers.lines, "opacity"), spots[0] + ".id");
  assert.equal(api.getInConnection(layers.glowLevel, "array.0"), spots[0] + ".id");
});

test("changeReveal on a reveal without its amount throws and deletes nothing", () => {
  const { api, S, sky, reveal } = revealFixture();
  const before = api.getChildren(reveal.groupId).slice();
  api.deleteLayer(S.findReveals(sky)[0].amountId);
  const kept = api.getChildren(reveal.groupId).slice();
  assert.ok(kept.length > 0 && kept.length === before.length - 1, "only the amount is gone");
  assert.throws(() => S.changeReveal(reveal.groupId, ["lines"], {}), /no amount utility/);
  assert.deepEqual(api.getChildren(reveal.groupId).slice(), kept, "its members are still there");
});

// ---- Controls (Task 10): the "<sky> Sky controls" and "<sky> Reveal controls" components ------------------
const SKY_CONTROL_ROWS = [
  "Camera · Centre RA", "Camera · Centre Dec", "Camera · Field of view", "Camera · Rotation",
  "Stars · Sky darkness (0 City – 100 Countryside)", "Stars · Size", "Stars · Glow",
  "Background · Colour",
  "Lines · Hide", "Lines · Colour", "Lines · Width",
  "Borders · Hide", "Borders · Colour", "Borders · Width",
  "Names · Hide", "Names · Colour", "Names · Size"
];
// The promoted rows' labels, in list order (a row's label is the name its source attribute carries). Inputs of a
// script (array.N) keep non-breaking spaces, as Cavalry needs them; the labels are compared with plain spaces.
function promotedLabels(api, comp) {
  return api._promoted(comp).map((s) => {
    const d = s.indexOf(".");
    return api.getCustomAttributeName(s.slice(0, d), s.slice(d + 1)).split(" ").join(" ");
  });
}
function compNamed(api, name) { return api.getCompLayers(false).find((id) => api.getNiceName(id) === name); }

test("createSky makes \"<sky> Sky controls\" holding the sky's rows, at the top level above the sky group", () => {
  const { api, sky } = skyFixture();
  const comp = compNamed(api, "Sky 1 Sky controls");
  assert.equal(api.getLayerType(comp), "component");
  assert.equal(api.getParent(comp), "", "a top-level layer, not inside the sky");
  assert.deepEqual(promotedLabels(api, comp), SKY_CONTROL_ROWS);
  assert.equal(compNamed(api, "Sky 1 Reveal controls"), undefined, "no reveal rows without a reveal");
  assert.equal(api.getChildren(sky.groupId).indexOf(comp), -1);
});

test("the Stars · Sky darkness input drives every band and the glow, and lives in the Sky controls", () => {
  const { api, layers } = skyFixture();
  const comp = compNamed(api, "Sky 1 Sky controls");
  const sources = layers.bands.concat([layers.glow]).map((id) => api.getInConnection(id, "generator.array.7"));
  assert.ok(sources.every((s) => s === sources[0] && s !== ""), "one input for all of them");
  assert.equal(api.getParent(sources[0].slice(0, sources[0].indexOf("."))), comp, "the input is in the Sky controls' values utility");
});

test("the Stars · Size input drives the bands and the glow too", () => {
  const { api, layers } = skyFixture();
  const sources = layers.bands.concat([layers.glow]).map((id) => api.getInConnection(id, "generator.array.8"));
  assert.ok(sources.every((s) => s === sources[0] && s !== ""));
});

test("a reveal gets \"<sky> Reveal controls\" with its rows; deleting it and syncing removes them, the Sky rows stay", () => {
  const { api, S, sky, context } = revealFixture();
  const reveals = compNamed(api, "Sky 1 Reveal controls");
  assert.ok(reveals, "the reveal controls");
  assert.deepEqual(promotedLabels(api, reveals).slice(0, 2), ["Reveal 1 · Amount %", "Reveal 1 · Spotlight"]);
  assert.ok(promotedLabels(api, reveals).includes("Reveal 1 · Title size"));
  assert.ok(promotedLabels(api, reveals).includes("Reveal 1 · Labels size"));
  api.deleteLayer(S.findReveals(sky)[0].groupId);
  S.prepareReveals(sky);
  syncNow(context, sky);
  assert.equal(compNamed(api, "Sky 1 Reveal controls"), undefined, "nothing wanted: the component is removed");
  assert.deepEqual(promotedLabels(api, compNamed(api, "Sky 1 Sky controls")), SKY_CONTROL_ROWS);
});

test("with two reveals the Reveal controls hold both blocks, Reveal 1 then Reveal 2", () => {
  const { api, S, sky, orion, context } = revealFixture();
  S.createReveal(sky, orion, ["lines"], 50, 25, {});
  syncNow(context, sky);
  const labels = promotedLabels(api, compNamed(api, "Sky 1 Reveal controls"));
  const at1 = labels.indexOf("Reveal 1 · Amount %"), at2 = labels.indexOf("Reveal 2 · Amount %");
  assert.ok(at1 >= 0 && at2 > at1, "Reveal 1's block, then Reveal 2's");
  assert.ok(labels.indexOf("Reveal 2 · Lines colour") > at2, "Reveal 2 has lines");
  assert.equal(labels.indexOf("Reveal 2 · Title size"), -1, "Reveal 2 has no title");
});

test("a row the user promoted stays after the plugin's rows, through a later sync", () => {
  const { api, sky, layers, context } = skyFixture();
  const comp = compNamed(api, "Sky 1 Sky controls");
  api.connect(layers.background, "hidden", comp, "promotedAttributes");
  syncNow(context, sky);
  const all = api._promoted(comp);
  assert.equal(all[all.length - 1], layers.background + ".hidden", "the user's row is last");
  assert.deepEqual(promotedLabels(api, comp).slice(0, SKY_CONTROL_ROWS.length), SKY_CONTROL_ROWS);
});

test("Disconnect is respected: a glow the user disconnects from the darkness input is not relinked by a sync", () => {
  const { api, sky, layers, context } = skyFixture();
  const source = api.getInConnection(layers.glow, "generator.array.7");
  const at = source.indexOf(".");
  api.disconnect(source.slice(0, at), source.slice(at + 1), layers.glow, "generator.array.7");
  syncNow(context, sky);
  assert.equal(api.getInConnection(layers.glow, "generator.array.7"), "", "the glow is not relinked");
  assert.notEqual(api.getInConnection(layers.bands[0], "generator.array.7"), "", "the bands still follow");
});

test("syncing again changes nothing", () => {
  const { api, sky, context } = revealFixture();
  const comp = compNamed(api, "Sky 1 Sky controls");
  const promoted = api._promoted(comp).slice(), links = api._connections.length;
  syncNow(context, sky);
  assert.deepEqual(api._promoted(comp), promoted);
  assert.equal(api._connections.length, links, "no connections added");
});

// Runs the Controls panel's sync, as the scene does after each action.
function syncNow(context, sky) {
  return context.AstroControlPanel.sync(sky);
}

// ---- Controls fix round 1: the glow's size, and scene writes that reach the Controls' values -------------
// The size a star layer draws with: its size input times the scale its expression gives (1 when none).
function effectiveSize(api, id) {
  const scale = /sizeScale: (\d+)/.exec(String(api.get(id, "generator.expression")));
  return Number(api.get(id, "generator.array.8")) * (scale ? Number(scale[1]) : 1);
}

test("the glow's base size equals the bands', and its expression draws it at 3 times that", () => {
  const { api, layers } = skyFixture();
  assert.equal(api.get(layers.glow, "generator.array.8"), api.get(layers.bands[0], "generator.array.8"));
  assert.equal(api.get(layers.bands[0], "generator.array.8"), 1);
  assert.equal(effectiveSize(api, layers.glow), 3 * effectiveSize(api, layers.bands[0]));
});

test("setDarkness writes the Controls input the bands and glow read: every effective darkness is 0", () => {
  const { api, S, sky, layers } = skyFixture();
  S.setDarkness(sky, 0);
  layers.bands.concat([layers.glow]).forEach((id) => assert.equal(api.get(id, "generator.array.7"), 0, api.getNiceName(id)));
});

test("setStarSize writes the Controls input: the bands draw at the size, the glow at 3 times it", () => {
  const { api, S, sky, layers } = skyFixture();
  S.setStarSize(sky, 2);
  layers.bands.forEach((id) => assert.equal(effectiveSize(api, id), 2, api.getNiceName(id)));
  assert.equal(effectiveSize(api, layers.glow), 6);
});

// ---- Controls fix round 2: setCamera and setWholeSky write through a fed input too -----------------------
test("setCamera after the sync: every sky layer's effective centre is the new one", () => {
  const { api, S, sky, layers, context } = skyFixture();
  syncNow(context, sky);
  S.setCamera(sky, { ra: 10, dec: 5, fov: 40, rotation: 0, projection: 0 });
  [layers.bands[0], layers.glow, layers.lines].forEach((id) => {
    assert.equal(api.get(id, "generator.array.0"), 10, api.getNiceName(id) + " centreRa");
    assert.equal(api.get(id, "generator.array.1"), 5, api.getNiceName(id) + " centreDec");
  });
});

test("setCamera on a camera input fed from a utility: the utility takes the value, and the camera reads it", () => {
  const { api, S, sky, context } = skyFixture();
  syncNow(context, sky);
  const feed = api.create("javaScript", "Feed");
  api.set(feed, { "array.0": 5 });
  api.connect(feed, "array.0", sky.cameraId, "array.0", true);
  S.setCamera(sky, { ra: 10, dec: 0, fov: 60, rotation: 0, projection: 0 });
  assert.equal(api.get(feed, "array.0"), 10, "the source holds the new centre");
  assert.equal(api.get(sky.cameraId, "array.0"), 10, "the camera reads it");
});

test("setWholeSky on Lines' hidden fed from a utility: the utility takes the value and the lines read it", () => {
  const { api, S, sky, layers, context } = skyFixture();
  syncNow(context, sky);
  const feed = api.create("javaScript", "Feed");
  api.set(feed, { "array.0": false });
  api.connect(feed, "array.0", layers.lines, "hidden", true);
  S.setWholeSky(sky, "lines", false);
  assert.equal(api.get(feed, "array.0"), true, "the source holds the hidden value");
  assert.equal(api.get(layers.lines, "hidden"), true, "the lines read it");
});

test("setWholeSky on an unfed attribute still writes it directly", () => {
  const { api, S, sky, layers, context } = skyFixture();
  syncNow(context, sky);
  S.setWholeSky(sky, "lines", false);
  assert.equal(api.get(layers.lines, "hidden"), true);
  S.setWholeSky(sky, "lines", true);
  assert.equal(api.get(layers.lines, "hidden"), false);
});

// ---- The panel: the Sky tab (Task 12) ---------------------------------------------------------------
// Helpers over the fake ui: every widget of a kind, by text, and the dropdown that lists a given entry.
function widgetsOfKind(ui, kind) { return ui._all().filter((w) => w.kind === kind); }
function findButton(ui, text) { return widgetsOfKind(ui, "Button").find((b) => b._text === text); }
function dropDownWith(ui, entry) { return widgetsOfKind(ui, "DropDown").find((d) => d._entries.indexOf(entry) >= 0); }
function numericFields(ui) { return widgetsOfKind(ui, "NumericField"); }
function lineEditWithPlaceholder(ui, text) { return widgetsOfKind(ui, "LineEdit").find((l) => l._placeholder === text); }
function statusText(ui) { return ui._root()._items.slice(-1)[0]._text; }
// Picks the "New sky" entry (always last in the list) and returns the dropdown.
function pickNewSky(ui) {
  const picker = dropDownWith(ui, "New sky");
  picker.setValue(picker._entries.length - 1);
  return picker;
}
// Searches for text as the user does: type it and press the Search button.
function search(ui, text) {
  lineEditWithPlaceholder(ui, "Search a constellation or star, e.g. Orion").setText(text);
  findButton(ui, "Search").onClick();
}

test("the Sky tab: New sky with Create sky here makes Sky 1, then Sky 2, at the preview's green frame", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene, made = [];
  const createSky = S.createSky;
  S.createSky = function (name, cam, theme) { made.push({ name: name, cam: cam }); return createSky(name, cam, theme); };
  const frame = context.AstroPreview.frameCamera(context.AstroPreview.defaultView());
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  assert.equal(made[0].name, "Sky 1");
  assert.ok(Math.abs(made[0].cam.ra - frame.ra) < 1e-9 && Math.abs(made[0].cam.fov - frame.fov) < 1e-9, "the green frame's camera");
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  assert.equal(made[1].name, "Sky 2");
  assert.equal(S.findSkies().length, 2);
});

test("searching orion lists Orion first, and Enter in Search runs the search too", () => {
  const { ui } = runPanel();
  search(ui, "orion");
  const picker = dropDownWith(ui, "Whole sky");
  assert.equal(picker._entries[0], "Whole sky");
  assert.equal(picker._entries[1], "Orion");
  lineEditWithPlaceholder(ui, "Search a constellation or star, e.g. Orion").setText("sirius");
  lineEditWithPlaceholder(ui, "Search a constellation or star, e.g. Orion").onValueCommitted();
  assert.equal(dropDownWith(ui, "Whole sky")._entries[1], "Sirius");
});

test("Fly here from frame 0 to 100 keys the camera on Orion and records a flight to it; the fields then chain", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  search(ui, "orion");
  const results = dropDownWith(ui, "Whole sky");
  results.setValue(1);
  results.onValueChanged();
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(100);
  findButton(ui, "Fly here").onClick();
  assert.deepEqual(api.getKeyframeTimes(sky.cameraId, "array.0").slice(0, 2), [0, 1]);
  assert.ok(api.getKeyframeTimes(sky.cameraId, "array.0").includes(100), "a key on the last frame");
  const rec = S.lastFlight(sky);
  assert.equal(rec.target.kind, "constellation");
  assert.equal(rec.target.label, "Orion");
  assert.equal(rec.start, 0);
  assert.equal(rec.end, 100);
  assert.equal(from.getValue(), 100, "From moves on to the flight's end");
  assert.equal(to.getValue(), 200, "To moves on by the flight's length");
});

test("Fly here past the comp end asks first, and on No it changes nothing", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(150);
  ui._modal.answer = false;
  findButton(ui, "Fly here").onClick();
  assert.equal(ui._modal.asked.length, 1, "the question was asked once");
  assert.equal(api.get(api.getActiveComp(), "endFrame"), 100, "the comp is not lengthened");
  assert.deepEqual(api.getKeyframeTimes(sky.cameraId, "array.0"), [], "no camera keys");
  assert.equal(S.lastFlight(sky), null);
  assert.ok(statusText(ui).indexOf("Cancelled") === 0, "the status line says so");
});

test("Fly here past the comp end on Yes extends the comp once, by the 3-second pad only", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(150);
  ui._modal.answer = true;
  findButton(ui, "Fly here").onClick();
  assert.equal(api.get(api.getActiveComp(), "endFrame"), 225, "150 + 3 seconds at 25 fps");
  assert.equal(S.lastFlight(S.findSkies()[0]).end, 150);
});

test("Jump here puts the camera on the green frame of the picked constellation", () => {
  const { ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  search(ui, "orion");
  const results = dropDownWith(ui, "Whole sky");
  results.setValue(1);
  results.onValueChanged();
  findButton(ui, "Jump here").onClick();
  const orion = S.skyData().cons.findIndex((c) => c.name === "Orion");
  const target = S.flyTarget("constellation", orion);
  const frame = context.AstroPreview.frameCamera({ ra: target.ra, dec: target.dec, fov: target.fov });
  const cam = S.readCamera(sky);
  assert.ok(Math.abs(cam.ra - frame.ra) < 1e-9 && Math.abs(cam.dec - frame.dec) < 1e-9, "the centre is the green frame's");
  assert.ok(Math.abs(cam.fov - frame.fov) < 1e-9, "the field of view is the green frame's");
});

test("Refresh controls and every press prepare the picked sky's reveals", () => {
  const { ui, context } = runPanel();
  const S = context.AstroScene, calls = [];
  const prepare = S.prepareReveals;
  S.prepareReveals = function (sky) { calls.push(sky.groupId); return prepare(sky); };
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const made = S.findSkies()[0].groupId;
  calls.length = 0;
  findButton(ui, "Refresh controls").onClick();
  assert.ok(calls.length >= 1 && calls.every((g) => g === made), "Refresh controls prepares the sky's reveals");
  calls.length = 0;
  findButton(ui, "Jump here").onClick();
  assert.ok(calls.indexOf(made) >= 0, "a press prepares them too");
});

test("every control in the panel has a hover tip, the settings popover's included", () => {
  const { ui } = runPanel();
  const tabs = ["Sky", "Stars", "Reveal"];
  const controls = ui._all().filter((w) => ["Button", "DropDown", "LineEdit", "NumericField", "Checkbox", "Slider", "List"].indexOf(w.kind) >= 0)
    .filter((w) => !(w.kind === "Button" && tabs.indexOf(w._text) >= 0));
  assert.ok(controls.length > 20, "the panel has its controls");
  controls.forEach((w) => {
    assert.ok(w._setToolTip && String(w._setToolTip[0]).length > 0, "a tip on " + (w._text || w.kind));
  });
});

// ---- Fix round 1 (Task 12): live theme save, and RA seeded at the flight's start -------------------------
// The largest RA step between consecutive frames from..to (raw degrees), restoring the playhead afterwards.
function maxRaStep(api, cam, from, to) {
  const back = api.getFrame();
  let prev = null, worst = 0;
  for (let f = from; f <= to; f++) {
    api.setFrame(f);
    const v = Number(api.get(cam, "array.0"));
    if (prev !== null) worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  api.setFrame(back);
  return worst;
}
// Links a utility's value to a layer's attribute, as a Controls row does: changing the utility changes the layer.
function linkedValue(api, layer, attr, value) {
  const feed = api.create("javaScript", "Feed");
  api.set(feed, { "array.0": value });
  api.connect(feed, "array.0", layer, attr, true);
  return feed;
}

test("readSkyTheme reads the live lines colour through a link, and is named", () => {
  const { api, S, sky, layers } = skyFixture();
  linkedValue(api, layers.lines, "stroke.strokeColor", "#ff8800");
  const theme = S.readSkyTheme(sky, "Mine");
  assert.deepEqual(api.get(layers.lines, "stroke.strokeColor"), { r: 255, g: 136, b: 0, a: 255 }, "read as a Cavalry colour object");
  assert.equal(theme.lines, "#ff8800");
  assert.equal(theme.name, "Mine");
  assert.equal(theme.borders, S.skyTheme(sky).borders, "a colour not changed keeps the stored theme's");
});

test("Save as style saves the live lines colour and makes the sky's theme that style", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  linkedValue(api, S.skyLayers(sky).lines, "stroke.strokeColor", "#ff8800");
  lineEditWithPlaceholder(ui, "Name for a new style").setText("Mine");
  findButton(ui, "Save as style").onClick();
  const path = Object.keys(api._files).find((p) => p.endsWith("/Sky styles/Mine.json"));
  assert.ok(path, "the style file was written to the Sky styles folder");
  assert.equal(JSON.parse(api._files[path]).lines, "#ff8800", "the saved file has the live colour");
  assert.equal(S.skyTheme(sky).name, "Mine", "the sky's theme is the saved style");
  assert.equal(S.skyTheme(sky).lines, "#ff8800");
});

test("Drift from frame 0 keys no RA step over 10 degrees, though the playhead's RA is about 180 degrees away", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  S.jumpCamera(sky, { ra: 350, dec: 0, fov: 60 });
  api.keyframe(sky.cameraId, 0, { "array.0": 350 });
  api.keyframe(sky.cameraId, 50, { "array.0": 10 });
  api.setFrame(50);
  dropDownWith(ui, "Pan left").setValue(2);
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(100);
  findButton(ui, "Drift").onClick();
  assert.ok(maxRaStep(api, sky.cameraId, 0, 100) < 10, "no step of 10 degrees or more");
  api.setFrame(0);
  const start = Number(api.get(sky.cameraId, "array.0"));
  assert.ok(Math.abs(start - 350) < 1, "the drift starts at RA 350, not at the playhead's RA");
});

test("Update flight redoes the flight under the playhead with the new Easing, keeping its frames and target", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  search(ui, "orion");
  const results = dropDownWith(ui, "Whole sky");
  results.setValue(1);
  results.onValueChanged();
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(100);
  findButton(ui, "Fly here").onClick();
  api.setFrame(50);
  dropDownWith(ui, "Gentle").setValue(1);
  findButton(ui, "Update flight").onClick();
  const rec = S.lastFlight(sky);
  assert.equal(rec.easing, "gentle", "the flight now uses the new easing");
  assert.equal(rec.start, 0);
  assert.equal(rec.end, 100);
  assert.equal(rec.target.label, "Orion");
  assert.ok(maxRaStep(api, sky.cameraId, 0, 100) < 10, "no RA step of 10 degrees or more");
});

// ---- The panel: the Stars and Reveal tabs, and ⚙ (Task 13) -------------------------------------------------
// The widget a tip (AstroTips key) was put on: its tooltip is the key's text, wrapped in lines of seven words.
function tipped(ui, context, key) {
  const want = context.AstroTips.text(key);
  return ui._all().find((w) => w._setToolTip && String(w._setToolTip[0]).replace(/\n/g, " ") === want);
}
// Picks the named constellations in the Reveal list, as a click does.
function pickConstellations(ui, names) {
  const list = widgetsOfKind(ui, "List")[0];
  list.pick(names.map((n) => list._model.find((r) => r.label === n).uuid));
}

test("the Stars tab: moving Sky darkness to 0 sets every band's darkness to 0", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  const darkness = widgetsOfKind(ui, "Slider")[0];
  darkness.setValue(0);
  darkness.onValueChanged();
  S.skyLayers(sky).bands.forEach((id) => assert.equal(api.get(id, "generator.array.7"), 0, api.getNiceName(id)));
});

test("the Reveal list holds all 88 constellations, alphabetical, when Find is empty", () => {
  const { ui, context } = runPanel();
  const names = widgetsOfKind(ui, "List")[0]._model.map((r) => r.label);
  assert.equal(names.length, 88);
  assert.deepEqual(names, names.slice().sort());
  assert.equal(names.length, context.AstroScene.skyData().cons.length);
});

test("the Reveal page: picking Orion after Fly here to Orion over 0 to 100 sets Start 60 and Frames 40; picking Cross  sets Start to the playhead and Frames to the fps", () => {
  const { api, ui, context } = runPanel();
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  search(ui, "orion");
  const results = dropDownWith(ui, "Whole sky");
  results.setValue(1);
  results.onValueChanged();
  const [from, to] = numericFields(ui);
  from.setValue(0);
  to.setValue(100);
  findButton(ui, "Fly here").onClick();
  api.setFrame(7);
  const start = tipped(ui, context, "reveal.start"), frames = tipped(ui, context, "reveal.frames");
  pickConstellations(ui, ["Orion"]);
  assert.equal(start.getValue(), 60, "the reveal starts 40% into the flight");
  assert.equal(frames.getValue(), 40, "and lasts to the flight's end");
  pickConstellations(ui, ["Cross"]);
  assert.equal(start.getValue(), 7, "a constellation not flown to starts at the playhead");
  assert.equal(frames.getValue(), 25, "for one second: the comp's fps");
});

test("Reveal selected with Orion and Cross  picked makes two reveals, Cross  first (list order), the second starting where the first ended", () => {
  const { api, ui, context } = runPanel();
  const S = context.AstroScene;
  pickNewSky(ui);
  findButton(ui, "Create sky here").onClick();
  const sky = S.findSkies()[0];
  pickConstellations(ui, ["Orion", "Cross"]);
  const start = tipped(ui, context, "reveal.start"), frames = tipped(ui, context, "reveal.frames");
  start.setValue(0);
  frames.setValue(20);
  findButton(ui, "Reveal selected").onClick();
  const reveals = S.findReveals(sky);
  assert.equal(reveals.map((r) => r.name).join(" | "), "Reveal 1: Cross | Reveal 2: Orion");
  assert.equal(api.getKeyframeTimes(reveals[0].amountId, "array.0").join(","), "0,20");
  assert.equal(api.getKeyframeTimes(reveals[1].amountId, "array.0").join(","), "20,40", "starts where Cross  ended");
  assert.equal(start.getValue(), 40, "Start moves on to where the last reveal ended");
});

test("Change reveal with nothing selected says so in the status line", () => {
  const { ui } = runPanel();
  findButton(ui, "Change reveal").onClick();
  assert.equal(statusText(ui), "Select a reveal group (or a layer inside it) in the Scene Window first.");
});

test("⚙ opens the settings popover with the three groups: Sky styles, Preferences and About", () => {
  const { ui } = runPanel();
  findButton(ui, "⚙").onClick();
  const popover = ui._all().find((w) => w._popover);
  assert.ok(popover, "the settings popover was shown");
  const groups = popover._layout._items[0]._items;
  assert.deepEqual(groups.map((p) => p._layout._items[0]._items[0]._text), ["Sky styles", "Preferences", "About"]);
});
