// The CavalryAstro panel. Ported from Cavalry Geo's panel.js (its Map tab and settings), keeping the sky features
// only: the Sky tab (sky list, Create sky here, search, the preview, Jump / Fly / Drift, Style and Refresh controls),
// the Stars and Reveal tabs (empty until their task lands) and the ⚙ settings. It runs when the script loads.
var ASTRO_TABS = ["Sky", "Stars", "Reveal"];
var NEW_SKY = "New sky", WHOLE_SKY = "Whole sky";
var DEFAULT_THEME = "Realistic";
var SEARCH_LIMIT = 20, SEARCH_RETRY_MS = 1500;
var EXTEND_PAD_SECONDS = 3;
var RESET_KEYS = ["flyEasing", "flyArc", "driftMove", "skyStyle"];

var statusLabel = new ui.Label("Ready.");
// The status line reads "<" as markup, so names typed by the user are shown with a ‹ instead.
function say(msg) {
  var text = String(msg).replace(/</g, "‹");
  statusLabel.setText(text);
  console.log("[CavalryAstro] " + text);
}
// Wraps a handler that is not a button click (pickers, text commits, preview clicks, start-up): errors go
// to the status line, nothing else is touched.
function guard(fn) {
  return function () {
    try { fn(); } catch (e) { say("Error: " + (e && e.message ? e.message : e)); }
  };
}
// Wraps a panel action's selection: Cavalry expands Scene Window groups to reveal selected nested layers, so a
// selection that now holds a nested layer is put back to what it was; then the viewport is nudged to redraw.
function currentSelection() {
  try { return typeof api.getSelection === "function" ? (api.getSelection() || []).slice() : null; } catch (e) { return null; }
}
function sameIds(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function keepGroupsCollapsed(before) {
  if (before === null || typeof api.getParent !== "function" || typeof api.select !== "function") return;
  try {
    var after = currentSelection();
    if (after === null || sameIds(before, after)) return;
    var nested = false;
    for (var i = 0; i < after.length; i++) {
      try { if (String(api.getParent(after[i])) !== "") { nested = true; break; } } catch (e) { /* not a layer with a parent */ }
    }
    if (nested) api.select(before);
  } catch (e) { /* cosmetic */ }
}
function nudgeRedraw() {
  try { if (typeof api.setFrame === "function" && typeof api.getFrame === "function") api.setFrame(api.getFrame()); } catch (e) { /* cosmetic */ }
}
// One action at a time: a button, an Enter that starts work or a preview click can pump Cavalry's events,
// so a second press could otherwise run nested inside the first.
var busy = false;
// While a long action runs Cavalry keeps the user's clicks and delivers them after it ends; clicks arriving in the
// next moment are those held-back ones and are dropped (quietly, keeping the action's message).
var SETTLE_AFTER_MS = 300, SETTLE_MIN_MS = 1500, settleUntil = 0;
function refuseIfBusy() {
  if (busy) { say("Still working on the last action…"); return true; }
  return Date.now() < settleUntil;
}
// Runs fn as the one current action; afterwards opens the settle window when it was a long one.
function runAsAction(fn) {
  var started = Date.now();
  busy = true;
  try { fn(); } finally {
    busy = false;
    var ended = Date.now();
    if (ended - started >= SETTLE_AFTER_MS) settleUntil = ended + Math.max(SETTLE_MIN_MS, ended - started);
  }
}
// guard() for a commit (Enter) that starts work: refused while another action runs.
function guardWork(fn) {
  return function () {
    if (refuseIfBusy()) return;
    if (Date.now() - syncedAt > SYNC_REPEAT_MS) syncToCanvas();
    runAsAction(guard(fn));
  };
}
// Wraps a button's click: the catch-up with the canvas, the one-action rule, the selection restore and the redraw
// nudge. With keepSelection the restore is skipped. With allowNested the click runs even while another is busy.
function guardAction(fn, keepSelection, allowNested) {
  return function () {
    if (!allowNested && refuseIfBusy()) return;
    syncToCanvas();
    var before = keepSelection ? null : currentSelection();
    var run = function () { try { fn(); } catch (e) { say("Error: " + (e && e.message ? e.message : e)); } };
    if (allowNested) run(); else runAsAction(run);
    keepGroupsCollapsed(before);
    nudgeRedraw();
  };
}
function column(items) {
  var v = new ui.VLayout();
  v.setMargins(0, 6, 0, 0); // flush left and right: everything shares one left edge
  if (typeof v.setSpaceBetween === "function") v.setSpaceBetween(4);
  // A heading sits close to what it introduces and further from what came before; panels are 5 px apart.
  var panelSeen = false;
  items.forEach(function (w, i) {
    if (i > 0 && AstroStyle.isHeading(w) && typeof v.addSpacing === "function") v.addSpacing(4);
    if (AstroStyle.isPanel(w)) { if (panelSeen && typeof v.addSpacing === "function") v.addSpacing(1); panelSeen = true; }
    v.add(w);
  });
  if (typeof v.addStretch === "function") v.addStretch(); // controls pack at the top
  return v;
}
function row() {
  var h = new ui.HLayout();
  if (typeof h.setMargins === "function") h.setMargins(0, 0, 0, 0);
  for (var i = 0; i < arguments.length; i++) h.add(arguments[i]);
  return h;
}
function indexOfId(list, id, fallback) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return fallback;
}
function playhead() {
  try { var f = Number(api.getFrame()); return isFinite(f) ? Math.round(f) : 0; } catch (e) { return 0; }
}
function questionDialog() {
  try {
    var m = typeof ui.Modal === "function" ? new ui.Modal() : null;
    return m && typeof m.showQuestion === "function" ? m : null;
  } catch (e) { return null; }
}
function fileNameOf(path) { return String(path).replace(/\\/g, "/").split("/").pop(); }
function setHiddenAll(widgets, hidden) {
  widgets.forEach(function (w) { if (w && typeof w.setHidden === "function") w.setHidden(hidden); });
}

// ---- The sky: its data, the skies in the active comp, and the preview ----------------------------------
// The catalogue is read on first use (scene.js decodes it once per session).
function skyData() { return AstroScene.skyData(); }
var skies = [];        // the skies of the active composition (AstroScene.findSkies)
var results = [];      // the search results, in the order of the Search list
var picked = null;     // { target, view }: the search result the preview is centred on, and the view it was centred at
var savedThemes = [];  // the saved themes read from the Sky styles folder
var syncedAt = 0, SYNC_REPEAT_MS = 300; // when the last catch-up ran; a commit within this long after a preview press skips it
var followedComp = null, compKey = "", shownColours = null;

// ---- Sky tab controls ----------------------------------------------------------------------------------
var skyPicker = new ui.DropDown();
var refreshSkiesBtn = AstroStyle.button("Refresh");
var nameField = new ui.LineEdit(); nameField.setPlaceholder("Sky name (blank = Sky 1, Sky 2…)");
var refreshControlsBtn = AstroStyle.button("Refresh controls");
var searchField = new ui.LineEdit(); searchField.setPlaceholder("Search a constellation or star, e.g. Orion");
var searchBtn = AstroStyle.primaryButton("Search");
var resultPicker = new ui.DropDown();
var jumpBtn = AstroStyle.button("Jump here");
var createHereBtn = AstroStyle.primaryButton("Create sky here");
// Fly here runs from Start to End (frames). Both open on the playhead and 100 frames on, and move on after each
// flight so the next one chains from where this one ended.
var flyStartField = new ui.NumericField(playhead());
var flyEndField = new ui.NumericField(playhead() + 100);
[flyStartField, flyEndField].forEach(function (f) {
  f.setType(0); f.setMin(0);
  if (typeof f.setFixedWidth === "function") f.setFixedWidth(48); // number-sized, so the whole Fly row fits
});
var flyStartBox = AstroStyle.frameField(flyStartField);
var flyEndBox = AstroStyle.frameField(flyEndField);
var fromLabel = new ui.Label("From:");
var toLabel = new ui.Label("To:");
var flyBtn = AstroStyle.primaryButton("Fly here");
var flyNote = AstroStyle.note("(animates the camera to the preview's green frame)");
var easingLabel = AstroStyle.fieldLabel("Easing");
var easingPicker = new ui.DropDown();
var arcLabel = AstroStyle.fieldLabel("Zoom-out");
var arcPicker = new ui.DropDown();
var updateFlightBtn = AstroStyle.button("Update flight");
var driftLabel = AstroStyle.fieldLabel("Drift move");
var driftPicker = new ui.DropDown();
var driftBtn = AstroStyle.button("Drift");
AstroFly.EASINGS.forEach(function (e) { easingPicker.addEntry(e.name); });
AstroFly.ARCS.forEach(function (a) { arcPicker.addEntry(a.name); });
AstroFly.DRIFTS.forEach(function (d) { driftPicker.addEntry(d.name); });
function pickedEasing() { return AstroFly.EASINGS[easingPicker.getValue()] || AstroFly.EASINGS[0]; }
function pickedArc() { return AstroFly.ARCS[arcPicker.getValue()] || AstroFly.ARCS[1]; }
function pickedDrift() { return AstroFly.DRIFTS[driftPicker.getValue()] || AstroFly.DRIFTS[0]; }
easingPicker.onValueChanged = guard(function () { AstroNet.updateSettings({ flyEasing: pickedEasing().id }); });
arcPicker.onValueChanged = guard(function () { AstroNet.updateSettings({ flyArc: pickedArc().id }); });
driftPicker.onValueChanged = guard(function () { AstroNet.updateSettings({ driftMove: pickedDrift().id }); });
// Search, Fly here and Create sky here share one width.
var SKY_ACTION_WIDTH = 84;
if (typeof searchBtn.setFixedWidth === "function") searchBtn.setFixedWidth(SKY_ACTION_WIDTH);
if (typeof flyBtn.setFixedWidth === "function") flyBtn.setFixedWidth(SKY_ACTION_WIDTH);

// Style section: the theme picker, applied to the sky, saved from it, or deleted.
var themePicker = new ui.DropDown();
var applyStyleBtn = AstroStyle.button("Apply to sky");
var styleNameField = new ui.LineEdit(); styleNameField.setPlaceholder("Name for a new style");
var saveStyleBtn = AstroStyle.button("Save as style");
var deleteStyleBtn = AstroStyle.quietButton("Delete style");
var refreshStylesBtn = AstroStyle.button("Refresh");
function styleList() { return AstroStyles.BUILT_IN.concat(savedThemes); }
function pickedTheme() { return styleList()[themePicker.getValue()] || AstroStyles.find(DEFAULT_THEME); }
// Lists the built-in themes then the saved ones, and picks `name` (Realistic when it isn't listed). Programmatic
// changes must not count as the user picking, so refreshingThemes makes the change handler ignore them.
var refreshingThemes = false;
function refreshThemePicker(name) {
  var list = styleList(), sel = 0;
  refreshingThemes = true;
  try {
    themePicker.clear();
    list.forEach(function (s, i) {
      themePicker.addEntry(s.name);
      if (typeof name === "string" && s.name.toLowerCase() === name.trim().toLowerCase()) sel = i;
    });
    themePicker.setValue(sel);
  } finally { refreshingThemes = false; }
}
function savedThemeNamed(name) {
  var key = String(name).trim().toLowerCase(), found = null;
  savedThemes.forEach(function (t) { if (!found && t.name.toLowerCase() === key) found = t; });
  return found;
}
// Reloads the saved themes from the folder and keeps the picked one. Returns a note for the skipped files not yet
// reported ("" when there are none). A quiet reload (start-up) reports nothing.
var reportedSkips = {};
function reloadStyleFiles(quiet) {
  var before = pickedTheme().name, r;
  try { r = AstroNet.readStyleFiles(); } catch (e) { r = AstroStyleFiles.readAll([]); }
  savedThemes = r.styles.slice();
  refreshThemePicker(before);
  if (pickedTheme().name !== before) { try { previewShowSky(); } catch (e) { /* the preview is a courtesy */ } }
  if (quiet) return "";
  var fresh = r.skipped.filter(function (p) { return !reportedSkips[p]; });
  if (!fresh.length) return "";
  fresh.forEach(function (p) { reportedSkips[p] = true; });
  var first = fresh[0];
  var why = r.reasons[first] === "duplicate" ? "\"" + String(r.names[first]).replace(/</g, "‹") + "\" is already saved." : "not a CavalryAstro style.";
  return "Skipped Sky styles/" + fileNameOf(first).replace(/</g, "‹") + ": " + why + (fresh.length > 1 ? " (and " + (fresh.length - 1) + " more)" : "");
}

// The sky the preview shows its colours of: the picked sky's own theme, or the picked theme for New sky.
function previewTheme() { return newSkySelected() ? pickedTheme() : AstroScene.skyTheme(currentSky()); }
// Paints the preview's sky (stars, lines, names) in a theme's colours, once per change of colour.
function setPreviewTheme(theme) {
  var key = JSON.stringify(AstroStyles.previewColors(theme));
  if (key === shownColours) return;
  var d = skyData();
  preview.setSky({ stars: d.stars, constellations: d.cons, theme: theme });
  shownColours = key;
}
function previewShowSky() {
  setPreviewTheme(previewTheme());
  previewShowCurrent();
}
// The dashed frame shows where the picked sky's camera is now.
function previewShowCurrent() {
  preview.setCurrent(newSkySelected() ? null : AstroScene.readCamera(currentSky()));
}
// Sizes the preview to the active composition's resolution (its green frame and camera outline take its aspect).
function syncCompSize() {
  var r = AstroAttrs.readResolution(api.get(api.getActiveComp(), AstroAttrs.COMP_RESOLUTION_ATTR));
  var key = r.width + "x" + r.height;
  if (key === compKey) return;
  compKey = key;
  preview.setCompSize(r.width, r.height);
}
// A click in the panel, or a press on a preview or the panel's background, catches the panel up with the canvas: the
// composition, the skies, the picked sky's reveals (any hand-deleted reveal releases the Spotlight) and the preview.
// It never moves the preview's view, so a press always works on the view the user sees. Never throws.
function syncToCanvas() {
  try {
    if (busy) return;
    syncedAt = Date.now();
    followActiveComp(false, true);
    syncCompSize();
    if (!newSkySelected()) AstroScene.prepareReveals(currentSky());
    previewShowSky();
  } catch (e) {
    console.log("[CavalryAstro] Catching up with the canvas failed: " + (e && e.message ? e.message : e));
  }
}

var preview = AstroPreviewPanel.create({
  onPick: function (i) { pickConstellation(i); },
  onPress: syncToCanvas
});

// "New sky" is always the last entry, and the one selected when the composition has no skies.
function newSkySelected() {
  var idx = skyPicker.getValue();
  return idx < 0 || idx >= skies.length;
}
function currentSky() {
  if (newSkySelected()) throw new Error("Pick a sky first, or make one with New sky and Create sky here (Sky tab).");
  return skies[skyPicker.getValue()];
}
function refreshSkies(selectGroupId) {
  skies = AstroScene.findSkies();
  skyPicker.clear();
  var sel = 0;
  skies.forEach(function (s, i) {
    skyPicker.addEntry(s.name);
    if (s.groupId === selectGroupId) sel = i;
  });
  skyPicker.addEntry(NEW_SKY);
  skyPicker.setValue(sel);
  refreshNewSkyFields();
  previewShowSky();
}
// The name and Create sky here show only while New sky is picked; the camera rows hide whole while it is.
var cameraPanel = null;
function refreshNewSkyFields() {
  var show = newSkySelected();
  setHiddenAll([nameField, createHereBtn], !show);
  setHiddenAll([jumpBtn, fromLabel, flyStartBox, flyStartField, toLabel, flyEndBox, flyEndField, flyBtn, flyNote,
    easingLabel, easingPicker, arcLabel, arcPicker, updateFlightBtn, driftLabel, driftPicker, driftBtn], show);
  setHiddenAll([applyStyleBtn, saveStyleBtn], show);
  if (cameraPanel) setHiddenAll([cameraPanel], show);
}
// "Sky 1" is the lowest free "Sky n"; a typed name that is taken gets a number ("Orion 2"). Existing skies are never renamed.
function skyNamesTaken() {
  var taken = {};
  AstroScene.findSkies().forEach(function (s) { taken[s.name] = true; });
  return taken;
}
function uniqueSkyName(name) {
  var taken = skyNamesTaken();
  if (!taken[name]) return name;
  for (var n = 2; ; n++) { if (!taken[name + " " + n]) return name + " " + n; }
}
function numberedSkyName() {
  var taken = skyNamesTaken();
  for (var n = 1; ; n++) { if (!taken["Sky " + n]) return "Sky " + n; }
}
// Index 0 of resultPicker is always Whole sky, so there is always a way back to the whole sky. A search result is
// results[i - 1] for picker index i.
function refreshResultPicker() {
  var sel = resultPicker.getValue();
  resultPicker.clear();
  resultPicker.addEntry(WHOLE_SKY);
  results.forEach(function (r) { resultPicker.addEntry(String(r.label).replace(/</g, "‹")); });
  resultPicker.setValue(sel > 0 && sel <= results.length ? sel : 0);
}
// Searches the catalogue and shows the first result centred in the preview, as Geo's Search does.
function searchSkies(q) {
  var d = skyData();
  results = AstroCatalog.search(q, d.cons, d.stars, SEARCH_LIMIT);
  lastQuery = q;
  refreshResultPicker();
  if (results.length) resultPicker.setValue(1);
  previewFollowPicked();
  return results;
}
var lastQuery = null, searchTry = { tried: null, triedAt: 0 };
// The same text tried within SEARCH_RETRY_MS is skipped, so a failed Enter is not run again as the box loses focus.
function recentlyTried(memo, q) {
  var now = Date.now();
  if (memo.tried === q && now - memo.triedAt < SEARCH_RETRY_MS) return true;
  memo.tried = q;
  memo.triedAt = now;
  return false;
}
// Centres the preview on the picked result (or the whole sky). Picking a result remembers its target, so Fly here can
// record it for the reveal, as long as the preview is still centred on it.
function previewFollowPicked() {
  var i = resultPicker.getValue();
  if (i > 0 && results[i - 1]) {
    var r = results[i - 1], target = AstroScene.flyTarget(r.kind, r.index);
    preview.setView({ ra: target.ra, dec: target.dec, fov: target.fov });
    picked = { target: target, view: preview.view() };
  } else {
    preview.setView(AstroPreview.defaultView());
    picked = null;
  }
  preview.setResults(results.map(function (r) { return { ra: r.ra, dec: r.dec }; }));
  previewShowCurrent();
}
// A press on a constellation in the preview picks it: its search result is selected, or it becomes the one result.
function pickConstellation(i) {
  if (!(i >= 0)) return;
  var at = -1;
  results.forEach(function (r, k) { if (at < 0 && r.kind === "constellation" && r.index === i) at = k; });
  if (at < 0) {
    var c = skyData().cons[i];
    results = [{ kind: "constellation", index: i, label: c.name, ra: c.centre[0], dec: c.centre[1] }];
    refreshResultPicker();
    at = 0;
  }
  resultPicker.setValue(at + 1);
  previewFollowPicked();
}
function sameView(a, b) { return !!a && !!b && a.ra === b.ra && a.dec === b.dec && a.fov === b.fov; }
// Where Jump here and Fly here go: the green frame, whose camera is exactly AstroPreview.frameCamera of the view.
// It names the picked constellation or star while the preview is still centred on it, else the preview frame.
function frameTarget() {
  var v = preview.view(), cam = AstroPreview.frameCamera(v);
  var on = picked && sameView(v, picked.view) ? picked.target : null;
  return {
    cam: cam, kind: on ? on.kind : null, index: on ? on.index : null, label: on ? on.label : "the preview frame",
    ra: cam.ra, dec: cam.dec, fov: cam.fov
  };
}
// The target a flight remembers, from the record of an earlier flight: its end view, and what it was flown to.
function flightTarget(rec) {
  var t = rec.target || {};
  return { kind: t.kind || null, index: t.index === undefined ? null : t.index, label: t.label || "the destination",
    ra: rec.to.ra, dec: rec.to.dec, fov: rec.to.fov };
}

// ---- Fly here, Drift and the composition's length ------------------------------------------------------
// Fly here and Drift share their checks: Start / End, the composition's first frame, and the Yes / No question before
// the composition is lengthened. Everything is checked (and a longer composition asked for) before anything changes.
function planMove(noun) {
  var sky = currentSky(), from = Math.round(Number(flyStartField.getValue())), to = Math.round(Number(flyEndField.getValue()));
  if (!(to >= from + 1)) throw new Error("Set End at least 1 frame after Start (a " + noun + " needs 2 frames or more).");
  var comp = AstroScene.compFrameRange();
  if (from < comp.start) throw new Error("Start is before the composition's first frame (" + comp.start + ").");
  return { sky: sky, from: from, to: to, comp: comp };
}
function moveFieldsOn(plan) {
  flyStartField.setValue(plan.to);
  flyEndField.setValue(plan.to + (plan.to - plan.from));
}
// The new end frame when the composition is extended, false = no need, null = the user said No (already told).
function extendForMove(plan, noun, button) {
  if (plan.to <= plan.comp.end) return false;
  var dialog = questionDialog();
  if (!dialog) throw new Error("End is after your composition's last frame (" + plan.comp.end + "). Set End to " + plan.comp.end +
    " or earlier, or lengthen the composition first.");
  var newEnd = Math.round(plan.to + EXTEND_PAD_SECONDS * AstroScene.compFps());
  if (!dialog.showQuestion("Extend the timeline", "This " + noun + " ends at frame " + plan.to + ", after your composition's last frame (" +
    plan.comp.end + "). " + button + " will extend the composition, and the layers that reach its end, to frame " + newEnd + " (" +
    EXTEND_PAD_SECONDS + " seconds after the " + noun + " ends). Continue?")) {
    say("Cancelled. Set End to " + plan.comp.end + " or earlier to stay within your composition.");
    return null;
  }
  var r = AstroScene.extendComp(plan.to);
  return r ? r.newEnd : false;
}

// ---- Settings: the cog's popover, its pieces, and the reset --------------------------------------------
var tipsGotItBtn = AstroStyle.primaryButton("Got it");
var tipsBtn = AstroStyle.quietButton("Show tips again");
var tipsTitle = new ui.Label("Start here");
if (typeof tipsTitle.setFontSize === "function") tipsTitle.setFontSize(11);
if (typeof tipsTitle.setTextColor === "function") tipsTitle.setTextColor(AstroStyle.HEADING_COLOR);
if (typeof tipsTitle.setFixedHeight === "function") tipsTitle.setFixedHeight(16);
var tipsBox = [tipsTitle].concat([
  "1. Make a sky: pick New sky, optionally name it, and press Create sky here.",
  "2. Find a constellation: type its name in Search and press Search, then pick it.",
  "3. Fly: set From and To and press Fly here to move the camera to the green frame.",
  "4. Reveal: on the Reveal tab, pick a constellation and press Reveal selected.",
  "Every sky's settings are in \"(sky name) Sky controls\" in the Scene Window."
].map(function (t) { return AstroStyle.note(t); }), [tipsGotItBtn]);
// Hides or shows the whole Start here box.
function showTips(show) { setHiddenAll(tipsBox, !show); }
function rememberTips(show) {
  showTips(show);
  AstroNet.updateSettings({ showTips: show });
}
tipsGotItBtn.onClick = guardAction(function () { rememberTips(false); });
tipsBtn.onClick = guardAction(function () {
  showTab("Sky");
  rememberTips(true);
});

var openStylesBtn = AstroStyle.button("Open styles folder");
var exportStyleBtn = AstroStyle.button("Export style…");
openStylesBtn.onClick = guardAction(function () {
  var dir = AstroNet.stylesDir();
  AstroNet.ensureDir(dir);
  if (!AstroNet.openPath(dir)) say("Your styles are in " + dir + ".");
  else say("Opened the Sky styles folder.");
});
exportStyleBtn.onClick = guardAction(function () {
  if (typeof ui.chooseFileToSave !== "function") throw new Error("This Cavalry has no save dialog: copy the file from the Sky styles folder instead.");
  // The dialog starts in the CavalryAstro folder (beside settings.json), not in the Sky styles folder.
  var start = AstroNet.settingsDir();
  AstroNet.ensureDir(start);
  var p = String(ui.chooseFileToSave(start, "JSON (*.json)") || "");
  if (!p) { say("Nothing was exported."); return; }
  if (!/\.json$/i.test(p)) p += ".json";
  var theme = pickedTheme();
  api.writeToFile(p, AstroStyleFiles.toText(theme), true);
  if (!api.filePathExists(p)) throw new Error("Couldn't write " + p + ".");
  say("Exported \"" + theme.name + "\" to " + p + ".");
});

var updateCheck = AstroStyle.toggle("Check for updates", (function () {
  try { return (AstroNet.loadSettings() || {}).checkForUpdates !== false; } catch (e) { return true; }
})());
updateCheck.onValueChanged = function (on) { guard(function () { AstroNet.updateSettings({ checkForUpdates: on ? true : false }); })(); };
var resetChoicesBtn = AstroStyle.quietButton("Reset remembered choices");
// Without a question dialog the first press asks, and a second press resets.
var resetChoicesArmed = false;
function disarmResetChoices() { resetChoicesArmed = false; resetChoicesBtn.setText("Reset remembered choices"); }
// The pickers first: their change handlers write settings, so the keys are removed after them.
function resetRememberedChoices() {
  easingPicker.setValue(0);
  arcPicker.setValue(1);
  driftPicker.setValue(0);
  refreshThemePicker(DEFAULT_THEME);
  AstroNet.removeSettings(RESET_KEYS);
  previewShowSky();
  say("Remembered choices reset to their defaults.");
}
resetChoicesBtn.onClick = guardAction(function () {
  var dialog = questionDialog();
  if (dialog) {
    disarmResetChoices();
    if (!dialog.showQuestion("Reset remembered choices", "Put easing, zoom-out, drift move and the default theme back to their defaults? Saved themes are kept.")) {
      say("Nothing was reset.");
      return;
    }
    resetRememberedChoices();
    return;
  }
  if (!resetChoicesArmed) {
    resetChoicesArmed = true;
    resetChoicesBtn.setText("Confirm: reset choices");
    say("This puts easing, zoom-out, drift move and the default theme back to their defaults. Saved themes are kept. Press \"Confirm: reset choices\" to reset.");
    return;
  }
  disarmResetChoices();
  resetRememberedChoices();
});
var aboutVersion = AstroStyle.note("CavalryAstro v" + ASTRO_VERSION);
var getUpdatesBtn = AstroStyle.button("Get updates…");
getUpdatesBtn.onClick = guardAction(function () {
  if (!AstroNet.openPath(AstroUpdate.RELEASES_URL)) { say("Download updates from " + AstroUpdate.RELEASES_URL); return; }
  say("Opened the CavalryAstro download page.");
});
var settingsColumn = column([
  AstroStyle.panel([
    AstroStyle.heading("Sky styles"),
    row(openStylesBtn, exportStyleBtn)
  ]),
  AstroStyle.panel([
    AstroStyle.heading("Preferences"),
    updateCheck.widget,
    tipsBtn,
    resetChoicesBtn
  ]),
  AstroStyle.panel([
    AstroStyle.heading("About"),
    aboutVersion,
    getUpdatesBtn
  ])
]);
// The popover's box, built once: null when this Cavalry has no popover (the Settings page is used then).
var settingsContainer = (function () {
  if (typeof ui.Container !== "function") return null;
  var box = new ui.Container();
  if (typeof box.showAsPopover !== "function") return null;
  var inset = new ui.VLayout();
  inset.setMargins(8, 8, 8, 8);
  inset.add(settingsColumn);
  box.setLayout(inset);
  box.setBackgroundColor(AstroStyle.PAGE_BACKGROUND);
  if (typeof box.setRadius === "function") box.setRadius(6, 6, 6, 6);
  return box;
})();
// Opening the settings first re-reads the style folder, so a theme dropped into it is listed.
var settingsReturn = null;
function toggleSettingsPage() {
  if (tabBar.selected() === "Settings") { showTab(settingsReturn || ASTRO_TABS[0]); return; }
  settingsReturn = tabBar.selected();
  showTab("Settings");
}
function openSettings() {
  disarmResetChoices();
  reloadStyleFiles(true);
  AstroCog.open(settingsContainer, cogBtn, toggleSettingsPage);
}
var cogBtn = AstroCog.button(guard(openSettings));

// ---- The Sky tab's column -----------------------------------------------------------------------------
var skyColumn = column(tipsBox.concat([
  AstroStyle.panel([
    row(skyPicker, refreshSkiesBtn),
    nameField,
    refreshControlsBtn
  ]),
  AstroStyle.panel([
    AstroStyle.heading("Search"),
    row(searchField, searchBtn),
    resultPicker
  ]),
  AstroStyle.panel([
    AstroStyle.heading("Preview (drag to move)"),
    preview.widget,
    row(jumpBtn),
    createHereBtn
  ]),
  cameraPanel = AstroStyle.panel([
    AstroStyle.heading("Camera"),
    row(flyBtn, fromLabel, flyStartBox, toLabel, flyEndBox),
    flyNote,
    row(easingLabel, easingPicker),
    row(arcLabel, arcPicker),
    updateFlightBtn,
    row(driftLabel, driftPicker, driftBtn)
  ]),
  AstroStyle.panel([
    AstroStyle.heading("Style"),
    row(themePicker, applyStyleBtn),
    row(styleNameField, saveStyleBtn, deleteStyleBtn),
    refreshStylesBtn
  ])
]));

// ---- Handlers -------------------------------------------------------------------------------------------
skyPicker.onValueChanged = guard(function () { refreshNewSkyFields(); previewShowSky(); });
resultPicker.onValueChanged = guard(function () { previewFollowPicked(); });
// Enter in Search lists the results, but never runs the same text twice.
searchField.onValueCommitted = guardWork(function () {
  var q = searchField.getText().trim();
  if (!q || q === lastQuery || recentlyTried(searchTry, q)) return;
  searchSkies(q);
  if (!results.length) { say("No results for \"" + q + "\"."); return; }
  say(results.length + " result(s). Pick one, then Jump here or Fly here.");
});
searchBtn.onClick = guardAction(function () {
  var q = searchField.getText().trim();
  if (!q) throw new Error("Type a constellation or star to search for.");
  if (q === lastQuery && results.length) {
    // Same text as the last search (often an Enter just now): use those results and keep the one picked.
    if (resultPicker.getValue() < 1) resultPicker.setValue(1);
    previewFollowPicked();
  } else {
    searchSkies(q);
  }
  if (!results.length) { say("No results for \"" + q + "\"."); return; }
  say(results.length + " result(s). Pick one, then Jump here or Fly here.");
});

refreshSkiesBtn.onClick = guardAction(function () {
  refreshSkies(newSkySelected() ? null : currentSky().groupId);
  var note = reloadStyleFiles(false);
  say(skies.length + " sky(ies) in this composition." + (note ? " " + note : ""));
});

// Makes a sky at the green frame, and selects it. It is named Sky 1, Sky 2... unless a name is typed.
createHereBtn.onClick = guardAction(function () {
  var f = AstroPreview.frameCamera(preview.view()), typed = nameField.getText().trim();
  var name = typed ? uniqueSkyName(typed) : numberedSkyName();
  var made = AstroScene.createSky(name, { ra: f.ra, dec: f.dec, fov: f.fov, rotation: 0, projection: 0 }, pickedTheme().name);
  refreshSkies(made.groupId);
  say("Created sky \"" + name + "\" at the preview frame. Its controls are in \"" + name + " Sky controls\" in the Scene Window.");
});

jumpBtn.onClick = guardAction(function () {
  var sky = currentSky(), t = frameTarget();
  AstroScene.jumpCamera(sky, t.cam);
  say("Camera jumped to " + t.label + " (field of view " + t.cam.fov.toFixed(1) + "°).");
  previewShowCurrent();
});

// Flies from the Start frame to the End frame, from the camera as it is at Start, to the green frame.
flyBtn.onClick = guardAction(function () {
  var plan = planMove("flight"), from = plan.from, to = plan.to, t = frameTarget();
  var extended = extendForMove(plan, "flight", "Fly here");
  if (extended === null) return;
  var easing = pickedEasing(), arc = pickedArc();
  var range = AstroScene.flyTo(plan.sky, { kind: t.kind, index: t.index, label: t.label, ra: t.ra, dec: t.dec, fov: t.fov },
    { start: from, end: to, easing: easing.id, arc: arc.id });
  var msg = "Flight to " + t.label + ": frames " + range.start + "–" + range.end + ".";
  if (extended) msg += " The composition was extended to frame " + extended + " (" + EXTEND_PAD_SECONDS + " seconds after the flight ends).";
  moveFieldsOn(plan);
  say(msg);
  previewShowCurrent();
});

// Redoes the flight under the playhead with the current Easing and Zoom-out, keeping its frames and destination.
updateFlightBtn.onClick = guardAction(function () {
  var sky = currentSky(), cr = AstroScene.compFrameRange();
  var rec = AstroScene.flightAt(sky, Math.max(cr.start, Math.min(cr.end, playhead())));
  if (!rec) throw new Error("Put the playhead inside a flight made with Fly here first.");
  if (rec.kind === "drift") throw new Error("That's a drift — choose a move and press Drift to redo it.");
  var easing = pickedEasing(), arc = pickedArc(), target = flightTarget(rec);
  // flyTo reads the camera at the flight's start frame for the flight's begin and its RA seed, not at the playhead.
  var range = AstroScene.flyTo(sky, target, { start: rec.start, end: rec.end, easing: easing.id, arc: arc.id });
  say("Flight to " + target.label + " (frames " + range.start + "–" + range.end + ") updated: " + easing.name + ", " + arc.name + " zoom-out.");
  previewShowCurrent();
});

// A small move from the camera as it is at Start, over Start to End: push in, pull out or pan.
driftBtn.onClick = guardAction(function () {
  var plan = planMove("drift"), from = plan.from, to = plan.to, sky = plan.sky;
  var extended = extendForMove(plan, "drift", "Drift");
  if (extended === null) return;
  var move = pickedDrift(), begin = AstroScene.readCameraAt(sky, from);
  var end = AstroFly.driftEnd(begin, move.id);
  var range = AstroScene.flyCamera(sky, AstroFly.driftPath(begin, end, to - from), from);
  AstroScene.recordFlight(sky, { kind: "drift", start: from, end: to,
    from: { ra: begin.ra, dec: begin.dec, fov: begin.fov }, to: { ra: end.ra, dec: end.dec, fov: end.fov }, move: move.id });
  var msg = "Drift (" + move.name.toLowerCase() + ") from frame " + range.start + " to " + range.end + ".";
  if (extended) msg += " The composition was extended to frame " + extended + " (" + EXTEND_PAD_SECONDS + " seconds after the drift ends).";
  moveFieldsOn(plan);
  say(msg);
  previewShowCurrent();
});

refreshControlsBtn.onClick = guardAction(function () {
  var sky = currentSky(), r = AstroControlPanel.sync(sky);
  var removed = AstroScene.prepareReveals(sky);
  say("Controls updated: " + r.controls + (r.controls === 1 ? " setting " : " settings ") + "in " + sky.name + " Sky controls." +
    (removed ? " " + removed + " broken reveal" + (removed === 1 ? " was" : "s were") + " removed." : ""));
});

refreshStylesBtn.onClick = guardAction(function () {
  var note = reloadStyleFiles(false);
  say("Sky styles reloaded: " + savedThemes.length + " saved." + (note ? " " + note : ""));
});
themePicker.onValueChanged = guard(function () {
  if (refreshingThemes) return;
  AstroNet.updateSettings({ skyStyle: pickedTheme().name });
  previewShowSky();
});
applyStyleBtn.onClick = guardAction(function () {
  var sky = currentSky(), theme = pickedTheme(), r = AstroScene.applyTheme(sky, theme);
  previewShowSky();
  var left = r.skipped ? " " + r.skipped + " animated or connected colour" + (r.skipped === 1 ? " was" : "s were") + " left alone." : "";
  say("Applied " + theme.name + " to " + sky.name + "." + left);
});
saveStyleBtn.onClick = guardAction(function () {
  var sky = currentSky(), name = styleNameField.getText().trim();
  if (!name) throw new Error("Type a name for the style first.");
  if (AstroStyles.isBuiltIn(name)) throw new Error(AstroStyles.builtIn(name).name + " is a built-in style — pick another name.");
  if (!AstroNet.filesSupported()) throw new Error("This Cavalry can't list folders, so styles can't be saved.");
  var existing = savedThemeNamed(name);
  if (existing) {
    var q = questionDialog();
    if (!q) throw new Error("\"" + existing.name + "\" is already saved — pick another name.");
    if (!q.showQuestion("Replace style", "Replace the saved style " + existing.name + "?")) { say("Nothing was saved."); return; }
    name = existing.name;
  }
  // The sky's live colours (Controls tweaks included), saved, and then the sky's theme, as Geo's Save as style tags its map.
  var theme = AstroScene.readSkyTheme(sky, name);
  AstroNet.writeStyleFile(theme);
  AstroScene.setSkyTheme(sky, theme);
  AstroNet.updateSettings({ skyStyle: name });
  reloadStyleFiles(true);
  refreshThemePicker(name);
  previewShowSky();
  say("Saved style \"" + name + "\" from " + sky.name + ".");
});
deleteStyleBtn.onClick = guardAction(function () {
  var theme = pickedTheme();
  if (AstroStyles.isBuiltIn(theme.name)) throw new Error("Built-in styles can't be deleted.");
  AstroNet.deleteStyleFile(theme.name);
  savedThemes = savedThemes.filter(function (t) { return t.name !== theme.name; });
  AstroNet.updateSettings({ skyStyle: DEFAULT_THEME });
  refreshThemePicker(DEFAULT_THEME);
  previewShowSky();
  say("Deleted style \"" + theme.name + "\".");
});

// ---- Hover help: every control's tip comes from AstroTips (src/cavalry/tips.js) --------------------------------
var TIP_TARGETS = [
  [cogBtn, "settings.cog"],
  [skyPicker, "sky.picker"],
  [refreshSkiesBtn, "sky.refreshSkies"],
  [nameField, "sky.name"],
  [refreshControlsBtn, "sky.refreshControls"],
  [searchField, "sky.search"],
  [searchBtn, "sky.search"],
  [resultPicker, "sky.results"],
  [jumpBtn, "sky.jump"],
  [createHereBtn, "sky.createHere"],
  [flyBtn, "sky.fly"],
  [flyStartField, "sky.flyFrom"],
  [flyEndField, "sky.flyTo"],
  [easingPicker, "sky.easing"],
  [arcPicker, "sky.zoomOut"],
  [updateFlightBtn, "sky.updateFlight"],
  [driftPicker, "sky.driftMove"],
  [driftBtn, "sky.drift"],
  [themePicker, "sky.theme"],
  [applyStyleBtn, "sky.applyTheme"],
  [styleNameField, "sky.styleName"],
  [saveStyleBtn, "sky.saveStyle"],
  [deleteStyleBtn, "sky.deleteStyle"],
  [refreshStylesBtn, "sky.refreshStyles"],
  [tipsGotItBtn, "sky.tipsGotIt"],
  [tipsBtn, "settings.showTips"],
  [openStylesBtn, "settings.openStyles"],
  [exportStyleBtn, "settings.exportStyle"],
  [updateCheck, "settings.updateCheck"],
  [resetChoicesBtn, "settings.reset"],
  [getUpdatesBtn, "settings.getUpdates"]
];
TIP_TARGETS.forEach(function (t) { AstroStyle.tip(t[0], AstroTips.text(t[1])); });

// ---- The tabs and the pages --------------------------------------------------------------------------------
var tabPages = null, tabBar = null, pageNames = ASTRO_TABS.slice();
// Stars and Reveal are empty pages until their tasks land.
function showTab(name) {
  var i = pageNames.indexOf(name);
  if (i < 0) return;
  tabBar.select(name);
  tabPages.setPage(i);
}

// ---- Following the active composition -------------------------------------------------------------------
// The panel shows the skies of the composition you are working in, so an edit never lands on a sky in another comp.
function activeCompId() {
  try { return api.getActiveComp(); } catch (e) { return null; }
}
// Re-reads the skies when the active comp changes (or a scene is loaded, sceneChanged).
function followActiveComp(sceneChanged, quiet) {
  try {
    if (sceneChanged) followedComp = null; // a new scene may reuse the old comp's id
    var now = activeCompId();
    if (now === null || now === followedComp) return;
    followedComp = now;
    var picked = null;
    try { if (!newSkySelected()) picked = currentSky().groupId; } catch (e) { picked = null; }
    refreshSkies(picked);
    syncCompSize();
    var name = "";
    try { name = String(api.getNiceName(now) || ""); } catch (e) { name = ""; }
    if (!quiet) say(name ? "Showing skies in " + name + "." : "Showing skies in this composition.");
  } catch (e) {
    console.log("[CavalryAstro] Following the composition failed: " + (e && e.message ? e.message : e));
  }
}
function CompFollower() {
  this.onCompChanged = function () { followActiveComp(false); };
  this.onSceneChanged = function () { followActiveComp(true); };
}

// ---- Start-up -----------------------------------------------------------------------------------------------
(function () {
  var s = {};
  try { s = AstroNet.loadSettings() || {}; } catch (e) { s = {}; }
  easingPicker.setValue(indexOfId(AstroFly.EASINGS, s.flyEasing, 0));
  arcPicker.setValue(indexOfId(AstroFly.ARCS, s.flyArc, 1));
  driftPicker.setValue(indexOfId(AstroFly.DRIFTS, s.driftMove, 0));
  showTips(s.showTips !== false);
  reloadStyleFiles(true);
  refreshThemePicker(s.skyStyle || DEFAULT_THEME);
})();

function buildUi() {
  AstroStyle.onBackgroundPress(syncToCanvas); // a press on the panel's background catches the panel up with the canvas
  ui.setTitle("CavalryAstro");
  if (typeof ui.setBackgroundColor === "function") ui.setBackgroundColor(AstroStyle.WINDOW_BACKGROUND);
  // Without a popover the settings are a page of their own: the cog shows it, and the tab bar leaves it out.
  if (!settingsContainer) pageNames.push("Settings");
  tabPages = AstroStyle.pageStack(AstroStyle.PAGE_BACKGROUND);
  pageNames.forEach(function (name) {
    tabPages.add(name === "Sky" ? skyColumn : name === "Settings" ? settingsColumn : column([]));
  });
  tabPages.finish();
  tabBar = AstroStyle.tabBar(ASTRO_TABS, function (name) { showTab(name); });
  var root = new ui.VLayout();
  root.setMargins(4, 4, 4, 4);
  root.add(row(tabBar.widget, cogBtn)); // the cog sits right of the tab bar
  root.add(tabPages.widget);
  if (typeof root.addStretch === "function") root.addStretch(); // keeps the status line at the bottom
  root.add(statusLabel);
  ui.add(root);
  ui.show();
  // The preview follows the panel's width (Cavalry's Draw doesn't stretch by itself).
  function fitPreview() {
    try {
      var g = tabBar.widget.geometry();
      // The tab bar and the cog share a row: the preview runs from the tab bar's left edge to the cog's right edge.
      var c = typeof cogBtn.geometry === "function" ? cogBtn.geometry() : null;
      var w = g ? (c && c.width ? c.x + c.width - g.x : g.width) : 0;
      // The panel's insets plus the coloured page's: they exist only when panels are Containers.
      var inset = AstroStyle.hasContainer() ? AstroStyle.PANEL_INSET + 2 * AstroStyle.PAGE_INSET : 0;
      if (w > 50 + inset) preview.setWidth(w - inset);
    } catch (e) { /* older Cavalry */ }
  }
  ui.onResize = fitPreview;
  fitPreview();
  guard(function () { syncCompSize(); refreshSkies(); })();
  followedComp = activeCompId();
  try { if (typeof ui.addCallbackObject === "function") ui.addCallbackObject(new CompFollower()); } catch (e) { /* an older Cavalry: the Refresh button still works */ }
  try { AstroUpdateCheck.run(say); } catch (e) { /* the update check never gets in the way */ }
}
buildUi();
