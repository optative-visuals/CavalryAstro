// Works out a sky's Controls: which settings the "<sky> Sky controls" and "<sky> Reveal controls" components show,
// in what order, under what names, and which layers each "control values" input should drive. Pure: AstroControlPanel
// (src/cavalry/controls.js) reads the sky into a plain model and applies the result. Ported from Cavalry Geo's core
// controls.js, trimmed to the sky: no map, route, data, furniture or night rows.
if (typeof AstroExpression === "undefined" && typeof require !== "undefined") { var AstroExpression = require("./expression.js"); }
var AstroControls = (function () {
  var E = AstroExpression;
  var IN = "generator.array.";
  var FILL = "material.materialColor", STROKE = "stroke.strokeColor", WIDTH = "stroke.width";
  var CAMERA = function (name) { return "array." + E.inputIndex(E.CAMERA_INPUTS, name); };
  var DARKNESS = IN + E.inputIndex(E.STAR_INPUTS, "darkness"), SIZE = IN + E.inputIndex(E.STAR_INPUTS, "size");
  var TEXT_SIZE = IN + E.inputIndex(E.TEXT_INPUTS, "textSize");
  var GLOW_LEVEL = "array." + E.inputIndex(E.GLOW_LEVEL_INPUTS, "level");
  var REVEAL = function (name) { return "array." + E.inputIndex(E.REVEAL_INPUTS, name); };
  var TITLE_SIZE = "fontSize";
  var SEP = " · ";
  var CORNERS = "0 top-left · 1 top-centre · 2 top-right · 3 bottom-left · 4 bottom-centre · 5 bottom-right";
  // The attributes a values input may drive on each kind of member: the glue reads their link state
  // (incoming connection, keyframes, geoLinks-style record) into each member's state.
  var STATE_ATTRS = { stars: [DARKNESS, SIZE], ring: [STROKE, WIDTH] };
  var GROUPS = ["main", "reveal"];

  // What a layer's record says once a values input has been connected to it.
  function recordFor(valuesId, key) { return valuesId + "|" + key; }

  // The members as { m: member, attr } targets, one per member (the same attribute on each).
  function targetsOf(members, attr) { return members.map(function (m) { return { m: m, attr: attr }; }); }

  // model: { valuesId, camera, background, bands: [{id, state}], glow: {id, state}, glowLevel, lines, borders, names,
  //          reveals: [{ id, number, name, amount, lines, border: {id, state}, borderGlow: {id, state}, labels, title }] }.
  // Direct members are layer ids; value members are { id, state }. A missing member is null or left out.
  function plan(model) {
    var out = { rows: [], groups: [] }, V = model.valuesId, group = "main", notes = "";
    function push(row, g) { out.rows.push(row); out.groups.push(g); }
    function direct(layer, attr, label, overrides) {
      var r = { kind: "direct", layer: layer, attr: attr, label: label };
      if (overrides) r.overrides = overrides;
      if (notes) r.notes = notes;
      push(r, group);
    }
    // One values input driving each target ({ m: member, attr }) it may: already ours → linked;
    // wired elsewhere, animated, or unlinked by the user on purpose → left alone; otherwise → link.
    // start: a new input begins at that value and drives every target, whatever they hold (for the plugin's own defaults).
    function valueTargets(key, type, label, targets, overrides, start) {
      var rec = recordFor(V, key), link = [], linked = [];
      targets.forEach(function (t) {
        var s = (t.m.state && t.m.state[t.attr]) || {};
        if (s.from) {
          if (s.from.indexOf(V + ".") === 0) linked.push({ layer: t.m.id, attr: t.attr });
          return;
        }
        if (s.keyed || s.record === rec) return;
        link.push({ layer: t.m.id, attr: t.attr });
      });
      if (link.length || linked.length) {
        var row = { kind: "value", key: key, type: type, label: label, link: link, linked: linked };
        if (overrides) row.overrides = overrides;
        if (start !== undefined) row.start = start;
        if (notes) row.notes = notes;
        push(row, group);
      }
    }
    // The same attribute on each of several members.
    function value(key, type, label, members, attr, overrides) {
      valueTargets(key, type, label, targetsOf(members, attr), overrides);
    }
    // Hide, colour and width of a line set (the constellation lines or borders).
    function lineRows(id, name) {
      if (!id) return;
      direct(id, "hidden", name + SEP + "Hide");
      direct(id, STROKE, name + SEP + "Colour");
      direct(id, WIDTH, name + SEP + "Width");
    }

    group = "main";
    var c = model.camera;
    if (c) {
      direct(c, CAMERA("centreRa"), "Camera" + SEP + "Centre RA");
      direct(c, CAMERA("centreDec"), "Camera" + SEP + "Centre Dec");
      direct(c, CAMERA("fov"), "Camera" + SEP + "Field of view");
      direct(c, CAMERA("rotation"), "Camera" + SEP + "Rotation");
    }
    // The star bands and the glow share one darkness and one size input each; the size starts at the bands' default.
    var stars = (model.bands || []).concat(model.glow ? [model.glow] : []);
    if (stars.length) {
      valueTargets("stars:darkness", "double", "Stars" + SEP + "Sky darkness (0 City – 100 Countryside)", targetsOf(stars, DARKNESS), { hardMin: 0, hardMax: 100 });
      valueTargets("stars:size", "double", "Stars" + SEP + "Size", targetsOf(stars, SIZE), { hardMin: 0 }, 1);
    }
    if (model.glowLevel) direct(model.glowLevel, GLOW_LEVEL, "Stars" + SEP + "Glow", { hardMin: 0, hardMax: 100 });
    if (model.background) direct(model.background, FILL, "Background" + SEP + "Colour");
    lineRows(model.lines, "Lines");
    lineRows(model.borders, "Borders");
    if (model.names) {
      direct(model.names, "hidden", "Names" + SEP + "Hide");
      direct(model.names, FILL, "Names" + SEP + "Colour");
      direct(model.names, TEXT_SIZE, "Names" + SEP + "Size");
    }

    // One block per reveal, in number order. Its notes name the constellation. A part that is not drawn drops its rows.
    group = "reveal";
    (model.reveals || []).forEach(function (r) {
      var n = "Reveal " + r.number + SEP, k = "reveal:" + r.id + ":", ring = [r.border, r.borderGlow].filter(Boolean);
      notes = r.name || "";
      direct(r.amount, REVEAL("amount"), n + "Amount %", { hardMin: 0, hardMax: 100 });
      direct(r.amount, REVEAL("spotlight"), n + "Spotlight", { hardMin: 0, hardMax: 100 });
      if (r.lines) {
        direct(r.lines, STROKE, n + "Lines colour");
        direct(r.lines, WIDTH, n + "Lines width");
      }
      if (ring.length) value(k + "border", "color", n + "Border colour", ring, STROKE);
      if (ring.length) valueTargets(k + "borderWidth", "double", n + "Border width", targetsOf(ring, WIDTH), { hardMin: 0 });
      // Title mode, corner, margin and offset place the title, so they are offered only while it is drawn.
      // The offset moves a Follows-constellation title; the margin insets a Header title from its corner.
      if (r.title) {
        direct(r.amount, REVEAL("titleMode"), n + "Title mode (0 Header · 1 Follows constellation)", { hardMin: 0, hardMax: 1, step: 1 });
        direct(r.amount, REVEAL("corner"), n + "Title corner (" + CORNERS + ")", { hardMin: 0, hardMax: 5, step: 1 });
        direct(r.amount, REVEAL("margin"), n + "Title margin", { hardMin: 0 });
        direct(r.amount, REVEAL("offsetY"), n + "Title offset");
        direct(r.title, TITLE_SIZE, n + "Title size");
        direct(r.title, FILL, n + "Title colour");
      }
      if (r.labels) {
        direct(r.labels, TEXT_SIZE, n + "Labels size");
        direct(r.labels, FILL, n + "Labels colour");
      }
      notes = "";
    });
    return out;
  }

  return { plan: plan, recordFor: recordFor, GROUPS: GROUPS, STATE_ATTRS: STATE_ATTRS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroControls;
