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

// Runs the built panel against the stubs and returns them, as Cavalry would when the script loads.
function runPanel() {
  const api = makeFakeApi();
  const ui = makeFakeUi();
  const sandbox = { api: api, ui: ui, console: console };
  const context = vm.createContext(sandbox);
  vm.runInContext(buildPanel(), context, { filename: "CavalryAstro.js" });
  return { api: api, ui: ui };
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
