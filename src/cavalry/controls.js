// Builds and updates a sky's Controls: "<sky> Sky controls" (the sky's settings) and, once the sky has reveals,
// "<sky> Reveal controls" (each reveal's settings). AstroControls decides what goes in them. Each component holds the
// "<sky> control values" utility: its inputs drive the settings shared by several layers (the star bands and glow,
// a reveal's border and its glow). Everything else is promoted straight from its layer and renamed there.
// Ported from Cavalry Geo's cavalry/controls.js (sync, placement, promotions, keeping the user's rows and Disconnect).
var AstroControlPanel = (function () {
  var A = AstroAttrs, C = AstroControls;
  var PROMOTED = "promotedAttributes";
  var CONTROLS_KEY = "astroControls", VALUES_KEY = "astroValues", SLOTS_KEY = "astroSlots", LINKS_KEY = "astroLinks", PROMOTED_KEY = "astroPromoted";
  var NOTES_KEY = "astroNotes", GROUP_KEY = "astroControlsGroup", GROUP_ORDER = C.GROUPS;
  var GROUP_SUFFIX = { main: " Sky controls", reveal: " Reveal controls" };
  var INPUT_TYPES = { double: "double", bool: "bool", color: A.COLOR_INPUT_TYPE };

  function has(fn) { return typeof api[fn] === "function"; }
  function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }
  function userData(id, key) {
    try { return api.hasUserDataKey(id, key) ? api.getUserDataKey(id, key) : null; } catch (e) { return null; }
  }
  function setUserData(id, key, value) {
    if (JSON.stringify(userData(id, key)) !== JSON.stringify(value)) api.setUserData(id, key, value);
  }
  function layerType(id) { try { return String(api.getLayerType(id)); } catch (e) { return ""; } }
  function one(attr, value) { var o = {}; o[attr] = value; return o; }

  // Cavalry strips plain spaces from the name of a script's dynamic input (array.N) but keeps
  // non-breaking ones (a script reading such an input still works). Built-in attributes keep plain spaces.
  var NBSP = " ";
  function inputLabel(path, label) { return /^array\.\d+$/.test(String(path)) ? String(label).split(" ").join(NBSP) : label; }

  function requireApis() {
    ["setUserData", "getUserDataKey", "hasUserDataKey", "removeArrayIndex", "getLayerType"].forEach(function (fn) {
      if (!has(fn)) throw new Error("This version of Cavalry can't update a sky's Controls.");
    });
  }

  // Cavalry may select layers it creates, and bringToFront acts on the selection: put the
  // user's selection back however this returns.
  function keepSelection(fn) {
    var previous = null;
    try { previous = api.getSelection(); } catch (e) { /* nothing to restore */ }
    try { return fn(); } finally {
      if (previous && has("select")) { try { api.select(previous); } catch (e) { /* cosmetic */ } }
    }
  }

  // A child of `parentId` of this type, tagged with user data key = value; else an untagged one with that name (never one tagged for something else).
  function findChild(parentId, type, key, value, name) {
    var kids = api.getChildren(parentId), byName = null;
    for (var i = 0; i < kids.length; i++) {
      if (layerType(kids[i]) !== type) continue;
      if (userData(kids[i], key) === value) return kids[i];
      if (!byName && api.getNiceName(kids[i]) === name && userData(kids[i], key) === null) byName = kids[i];
    }
    return byName;
  }

  // True when the layer sits anywhere inside the sky group (at any depth).
  function insideSky(id, sky) {
    for (var p = id, n = 0; p && n < 50; n++) { p = api.getParent(p) || ""; if (p === sky.groupId) return true; }
    return false;
  }

  // What holds the sky group: its parent, or the composition itself at the top level.
  function containerOf(sky) {
    var parent = "";
    try { parent = api.getParent(sky.groupId) || ""; } catch (e) { /* treat as top level */ }
    return { parent: String(parent), id: parent ? String(parent) : api.getActiveComp() };
  }

  function groupTag(id) { var g = userData(id, GROUP_KEY); return typeof g === "string" && g ? g : "main"; }

  // A component tagged for this sky and group (main = no group key); else, when `adopt` says so
  // (only while making one), an untagged one with the group's name.
  function findGroupIn(parentId, sky, group, adopt) {
    var kids = api.getChildren(parentId), byName = null, name = sky.name + GROUP_SUFFIX[group];
    for (var i = 0; i < kids.length; i++) {
      if (layerType(kids[i]) !== "component") continue;
      var cam = userData(kids[i], CONTROLS_KEY);
      if (cam === sky.cameraId && groupTag(kids[i]) === group) return kids[i];
      if (adopt && !byName && cam === null && api.getNiceName(kids[i]) === name) byName = kids[i];
    }
    return byName;
  }

  // Any component in the composition tagged as this sky's Controls for a group (the user may have moved it).
  // With a `cache` object one scan of the composition serves every group.
  function findAnywhere(sky, group, cache) {
    var found = cache && cache.found;
    if (!found) {
      var layers = [];
      found = {};
      try { layers = api.getCompLayers(false) || []; } catch (e) { /* not available */ }
      for (var i = 0; i < layers.length; i++) {
        if (layerType(layers[i]) !== "component" || userData(layers[i], CONTROLS_KEY) !== sky.cameraId) continue;
        var tag = groupTag(layers[i]);
        if (!found[tag]) found[tag] = layers[i];
      }
      if (cache) cache.found = found;
    }
    return found[group] || null;
  }

  // Puts a new (or just moved out) component in the sky's container, directly above the first existing
  // component of a later group, or above the sky group when there is none. After that the plugin never moves
  // it again. Without the optional calls it stays wherever it landed.
  function place(comp, sky, group) {
    var where = containerOf(sky), target = sky.groupId;
    attempt(function () {
      for (var j = GROUP_ORDER.indexOf(group) + 1; j < GROUP_ORDER.length; j++) {
        var later = findGroupIn(where.id, sky, GROUP_ORDER[j], false);
        if (later) { target = later; return; }
      }
    });
    attempt(function () {
      if (where.parent) api.parent(comp, where.parent);
      // Cavalry's unParent moves a layer up one level only, so it repeats until the layer is at the top (guarded).
      else if (has("unParent")) for (var n = 0; n < 20 && api.getParent(comp); n++) api.unParent(comp);
    });
    if (!has("bringForward") || !has("moveBackward") || !has("select")) return;
    attempt(function () {
      var guard = api.getChildren(where.id).length + 1;
      api.select([comp]);
      for (var i = 0; i < guard; i++) {
        var kids = api.getChildren(where.id), at = kids.indexOf(comp), g = kids.indexOf(target);
        if (at < 0 || g < 0 || at === g - 1) return;
        if (at < g - 1) api.moveBackward(); else api.bringForward();
      }
    });
  }

  // The main component (just above the sky group) and the values utility inside it.
  function findOrCreate(sky, cache) {
    return keepSelection(function () {
      var compName = sky.name + GROUP_SUFFIX.main, valuesName = sky.name + " control values";
      var comp = findGroupIn(containerOf(sky).id, sky, "main", true), move = false;
      if (!comp) comp = findAnywhere(sky, "main", cache);
      if (!comp) { comp = api.create("component", compName); move = true; }
      setUserData(comp, CONTROLS_KEY, sky.cameraId);
      if (move) place(comp, sky, "main");
      var values = findChild(comp, A.CAMERA_LAYER_TYPE, VALUES_KEY, sky.cameraId, valuesName);
      if (!values) {
        values = api.create(A.CAMERA_LAYER_TYPE, valuesName);
        api.set(values, one(A.CAMERA_EXPR_ATTR, A.CAMERA_BODY)); // reads none of its inputs, so renaming them is safe
        api.parent(values, comp);
      }
      setUserData(values, VALUES_KEY, sky.cameraId);
      return { id: comp, valuesId: values };
    });
  }

  // The reveal component: found again, or made when `create` says it is needed.
  function findOrCreateGroup(sky, group, create, cache) {
    return keepSelection(function () {
      var comp = findGroupIn(containerOf(sky).id, sky, group, create), move = false;
      // Found elsewhere: a user's own placement is kept, but one that landed inside the sky group goes back to the top level.
      if (!comp) { comp = findAnywhere(sky, group, cache); move = !!comp && insideSky(comp, sky); }
      if (!comp && create) { comp = api.create("component", sky.name + GROUP_SUFFIX[group]); move = true; }
      if (!comp) return null;
      setUserData(comp, CONTROLS_KEY, sky.cameraId);
      setUserData(comp, GROUP_KEY, group);
      if (move) place(comp, sky, group);
      return comp;
    });
  }

  function linkState(id, attrs) {
    var links = userData(id, LINKS_KEY) || {}, state = {};
    attrs.forEach(function (attr) {
      var from = "", keyed = false;
      try { from = String(api.getInConnection(id, attr) || ""); } catch (e) { /* not connectable */ }
      try { keyed = (api.getKeyframeTimes(id, attr) || []).length > 0; } catch (e) { /* no keys */ }
      state[attr] = { from: from, keyed: keyed, record: links[attr] || null };
    });
    return state;
  }

  // The sky as a plain model for AstroControls.plan: layer ids for the direct rows, and { id, state } for the
  // members a values input may drive.
  function readModel(sky, valuesId) {
    var S = AstroScene, L = S.skyLayers(sky), K = C.STATE_ATTRS;
    var model = { valuesId: valuesId, camera: sky.cameraId, background: L.background, glowLevel: L.glowLevel,
      lines: L.lines, borders: L.borders, names: L.names, bands: [], glow: null, reveals: [] };
    model.bands = L.bands.map(function (id) { return { id: id, state: linkState(id, K.stars) }; });
    if (L.glow) model.glow = { id: L.glow, state: linkState(L.glow, K.stars) };
    S.findReveals(sky).forEach(function (r) {
      var m = S.revealMembers(r), ring = function (id) { return id ? { id: id, state: linkState(id, K.ring) } : null; };
      model.reveals.push({ id: r.groupId, number: r.number, name: m.constellation, amount: r.amountId, lines: m.lines,
        border: ring(m.border), borderGlow: ring(m.borderGlow), labels: m.labels, title: m.title });
    });
    return model;
  }

  function hex(v) {
    if (v && typeof v === "object" && v.r !== undefined) {
      return "#" + [v.r, v.g, v.b].map(function (n) { var s = Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
    }
    return v;
  }

  function read(t) { try { return api.get(t.layer, t.attr); } catch (e) { return undefined; } }

  // Whether a target already shows the value a new input starts with. Nothing to compare
  // (either side unreadable) counts as the same.
  function same(type, a, b) {
    if (a === undefined || a === null || b === undefined || b === null) return true;
    if (type === "color") {
      var norm = function (v) { v = String(hex(v)).toLowerCase(); return v.charAt(0) === "#" && v.length === 9 ? v.slice(0, 7) : v; };
      return norm(a) === norm(b);
    }
    if (type === "bool") return !!a === !!b;
    return Math.abs(Number(a) - Number(b)) < 1e-6;
  }

  // The values input for a row: found again by its key, or added (starting with the first
  // target's current value). Returns its path, and whether it was added just now (with the
  // value it started from).
  function ensureSlot(valuesId, slots, row) {
    var path = slots[row.key];
    var there = false;
    if (path) { try { there = !!api.hasAttribute(valuesId, path); } catch (e) { there = false; } }
    if (there) return { path: path, created: false };
    path = api.addDynamic(valuesId, A.CAMERA_ARRAY_ATTR, INPUT_TYPES[row.type]);
    if (!path) throw new Error("Couldn't add a control value.");
    slots[row.key] = path;
    var seed = row.start !== undefined ? row.start : read(row.linked[0] || row.link[0]);
    attempt(function () {
      if (seed === undefined || seed === null) return;
      api.set(valuesId, one(path, row.type === "color" ? A.COLOR_VALUE(hex(seed)) : row.type === "bool" ? !!seed : Number(seed)));
    });
    return { path: path, created: true, seed: seed };
  }

  // Records on a target that the plugin has linked (or set apart) for this input, so a later sync leaves a
  // target the user disconnects alone.
  function record(layer, attr, value) {
    var links = userData(layer, LINKS_KEY) || {};
    if (links[attr] === value) return;
    links[attr] = value;
    attempt(function () { api.setUserData(layer, LINKS_KEY, links); });
  }

  // The list's length is the highest filled slot + 1 (other inputs don't count). `status`, when
  // given, gets `ok` = whether the list could be read at all (an unreadable list reads as empty).
  function readPromotions(comp, status) {
    var count = 0, list = [], slot = /^promotedAttributes\.(\d+)\.attribute$/;
    if (status) status.ok = true;
    try {
      api.getInConnectedAttributes(comp).forEach(function (a) {
        var m = slot.exec(String(a));
        if (m && Number(m[1]) + 1 > count) count = Number(m[1]) + 1;
      });
    } catch (e) { count = 0; if (status) status.ok = false; }
    for (var i = 0; i < count; i++) {
      var src = "", name = "", notes = "";
      try { src = String(api.getInConnection(comp, PROMOTED + "." + i + ".attribute") || ""); } catch (e) { /* empty slot */ }
      try { name = String(api.get(comp, PROMOTED + "." + i + ".name") || ""); } catch (e) { /* no name */ }
      try { notes = String(api.get(comp, PROMOTED + "." + i + ".notes") || ""); } catch (e) { /* no notes */ }
      var dot = src.indexOf(".");
      list.push({ layer: dot > 0 ? src.slice(0, dot) : src, attr: dot > 0 ? src.slice(dot + 1) : "", name: name, notes: notes });
    }
    return list;
  }
  function keyOf(p) { return p.layer + "." + p.attr; }

  // The list should be the plan's rows, then the user's own promotions. A promotion is the
  // plugin's when an earlier sync promoted it (astroPromoted on the component), this sync wants
  // it, or it comes from the values layer; everything else is the user's, whatever its layer.
  // Cavalry can't reorder promotions, so the list is kept up to the first difference and
  // everything after it is removed (highest first) and added again in order.
  // `names` ({ "layer.attr": { name, notes } }, read before anything moved) gives a row the plugin
  // adds again the name and notes the user had typed on it.
  function rebuild(comp, valuesId, wanted, names) {
    var current = readPromotions(comp), ours = {}, stored = userData(comp, PROMOTED_KEY);
    (Array.isArray(stored) ? stored : []).concat(wanted.map(keyOf)).forEach(function (k) { ours[k] = true; });
    var theirs = current.filter(function (p) { return p.layer && p.layer !== valuesId && !ours[keyOf(p)]; });
    var target = wanted.concat(theirs), from = 0;
    while (from < current.length && from < target.length && keyOf(current[from]) === keyOf(target[from])) from++;
    if (from < current.length || from < target.length) {
      for (var i = current.length - 1; i >= from; i--) {
        var path = PROMOTED + "." + i;
        attempt(function () { api.removeArrayIndex(comp, path); });
      }
      // Adding to a list that wasn't cleared would only make it longer on every sync.
      if (readPromotions(comp).length > from) throw new Error("Couldn't clear the old controls list.");
      var n = from;
      target.slice(from).forEach(function (p, k) {
        if (!attempt(function () { api.connect(p.layer, p.attr, comp, PROMOTED); })) return;
        var mine = from + k >= wanted.length, typed = mine ? p : names && names[keyOf(p)];
        if (typed && (mine || typed.name || typed.notes)) {
          var o = {};
          o[PROMOTED + "." + n + ".name"] = typed.name || "";
          o[PROMOTED + "." + n + ".notes"] = typed.notes || "";
          attempt(function () { api.set(comp, o); });
        }
        n++;
      });
    }
    attempt(function () { setUserData(comp, PROMOTED_KEY, wanted.map(keyOf)); });
  }

  // Plugin notes on promotions (the constellation a reveal row names): (re)set only where the notes are empty or
  // still the plugin's own. Each row's promotion slot is looked up by its key.
  function applyNotes(comp, wanted) {
    var stored = userData(comp, NOTES_KEY) || {}, next = {}, at = {};
    readPromotions(comp).forEach(function (p, i) { var k = keyOf(p); if (at[k] === undefined) at[k] = i; });
    wanted.forEach(function (w) {
      var key = keyOf(w), cur = "";
      if (w.notes) next[key] = w.notes;
      if (at[key] === undefined) return;
      var path = PROMOTED + "." + at[key] + ".notes";
      try { cur = String(api.get(comp, path) || ""); } catch (e) { cur = ""; }
      if (w.notes && cur !== w.notes && (cur === "" || cur === stored[key])) attempt(function () { api.set(comp, one(path, w.notes)); });
    });
    attempt(function () { setUserData(comp, NOTES_KEY, next); });
  }

  // Brings the sky's Controls up to date: the main component and its values utility, every row
  // (renamed, with its limits), each values input's links, and the reveal component (made, kept or removed).
  // Returns { componentId, valuesId, controls, components }.
  function sync(sky) {
    requireApis();
    var cache = {}, made = findOrCreate(sky, cache), V = made.valuesId;
    var p = C.plan(readModel(sky, V));
    var slots = userData(V, SLOTS_KEY) || {}, wanted = { main: [], reveal: [] };
    // A failing row only drops its own promotion; the inputs added so far are always recorded.
    try {
      p.rows.forEach(function (row, i) {
        if (row.kind === "direct") {
          attempt(function () { api.renameAttribute(row.layer, row.attr, inputLabel(row.attr, row.label)); });
          if (row.overrides && has("setAttributeDefinitionOverride")) {
            Object.keys(row.overrides).forEach(function (k) {
              attempt(function () { api.setAttributeDefinitionOverride(row.layer, row.attr, k, row.overrides[k]); });
            });
          }
          wanted[p.groups[i]].push({ layer: row.layer, attr: row.attr, notes: row.notes || "" });
          return;
        }
        attempt(function () {
          var slot = ensureSlot(V, slots, row), path = slot.path, rec = C.recordFor(V, row.key);
          attempt(function () { api.renameAttribute(V, path, inputLabel(path, row.label)); });
          if (row.overrides && has("setAttributeDefinitionOverride")) {
            Object.keys(row.overrides).forEach(function (k) { attempt(function () { api.setAttributeDefinitionOverride(V, path, k, row.overrides[k]); }); });
          }
          row.link.forEach(function (t) {
            // A new input links only the targets already showing its value; any other target
            // was set apart on purpose, so it is marked as if the user had pressed Disconnect.
            if (slot.created && row.start === undefined && !same(row.type, slot.seed, read(t))) { record(t.layer, t.attr, rec); return; }
            if (attempt(function () { api.connect(V, path, t.layer, t.attr, true); })) record(t.layer, t.attr, rec);
          });
          wanted[p.groups[i]].push({ layer: V, attr: path, notes: row.notes || "" });
        });
      });
    } finally {
      attempt(function () { setUserData(V, SLOTS_KEY, slots); });
    }
    // Names and notes typed on any row of either component, so a row that moves keeps them.
    var typed = {};
    GROUP_ORDER.forEach(function (g) {
      var existing = g === "main" ? made.id : (findGroupIn(containerOf(sky).id, sky, g, false) || findAnywhere(sky, g, cache));
      if (!existing) return;
      readPromotions(existing).forEach(function (q) { if (q.name || q.notes) typed[keyOf(q)] = { name: q.name, notes: q.notes }; });
    });
    rebuild(made.id, V, wanted.main, typed);
    applyNotes(made.id, wanted.main);
    var components = { main: made.id, reveal: null };
    var reveal = findOrCreateGroup(sky, "reveal", wanted.reveal.length > 0, cache);
    if (reveal) {
      rebuild(reveal, V, wanted.reveal, typed);
      applyNotes(reveal, wanted.reveal);
      // A reveal component the plugin no longer needs is removed: nothing wanted, nothing inside, and
      // a promotions list that was read successfully and is empty (an unreadable one is left alone).
      var after = { ok: true };
      if (!wanted.reveal.length && !readPromotions(reveal, after).length && after.ok && !api.getChildren(reveal).length) {
        attempt(function () { api.deleteLayer(reveal); });
      } else {
        components.reveal = reveal;
      }
    }
    return { componentId: made.id, valuesId: V, controls: wanted.main.length + wanted.reveal.length, components: components };
  }

  return { sync: sync };
})();
