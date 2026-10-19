// Creates, connects and reads CavalryAstro's sky in Cavalry. Panel-only: uses `api`.
// A sky is a group holding a Camera utility, a background rectangle, one star layer per non-empty colour band,
// a glow (the bright stars, blurred), the constellation lines, borders and names. Every layer that draws the
// sky takes its camera from the Camera (the Cavalry Geo pattern). The group's user data astroSky holds its theme.
var AstroScene = (function () {
  var A = AstroAttrs;
  var E = AstroExpression;
  var SKY_KEY = "astroSky", SKY_VERSION = 1;
  var GLOW_MAG = 2.5, GLOW_SIZE = 3, GLOW_BLUR = 6;
  var PARTS = ["lines", "borders", "names"];
  var NAMES = { camera: "Camera", background: "Sky background", glow: "Star glow", lines: "Constellation lines",
    borders: "Constellation borders", names: "Constellation names" };
  // The sky layer kinds (render.js) and the inputs each one takes.
  var KIND_INPUTS = { stars: E.STAR_INPUTS, lines: E.LINE_INPUTS, border: E.SKY_INPUTS, texts: E.TEXT_INPUTS };
  var CAMERA_KEYS = ["ra", "dec", "fov", "rotation", "projection"];

  var sky = null;   // the decoded catalogue, read once per session

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function numberOr(v, fallback) { var n = Number(v); return v === null || v === undefined || !isFinite(n) ? fallback : n; }

  function userData(id, key) {
    try { return typeof api.hasUserDataKey === "function" && api.hasUserDataKey(id, key) ? api.getUserDataKey(id, key) : null; } catch (e) { return null; }
  }
  function readExpr(id, attr) {
    if (!api.hasAttribute(id, attr)) return "";
    try { return String(api.get(id, attr) || ""); } catch (e) { return ""; }
  }
  function setOne(id, attr, value) { var o = {}; o[attr] = value; api.set(id, o); }

  // The catalogue, decoded on first use. Throws a plain message when the sky data is not in the assets folder.
  function skyData() {
    if (sky) return sky;
    var dir = A.ASSETS_DIR() + "/sky/", starsJson, consJson;
    try {
      starsJson = JSON.parse(String(api.readFromFile(dir + "stars.json")));
      consJson = JSON.parse(String(api.readFromFile(dir + "constellations.json")));
    } catch (e) {
      throw new Error("The sky data is missing from the CavalryAstro_assets folder.");
    }
    sky = { stars: AstroCatalog.decodeStars(starsJson), cons: AstroCatalog.decodeConstellations(consJson) };
    return sky;
  }

  // The theme from a theme object or a theme name (built-in). A bad object gives Realistic.
  function themeFor(theme) {
    if (typeof theme === "string") return AstroStyles.find(theme);
    return AstroStyles.normalise(theme) || AstroStyles.find("Realistic");
  }

  // Camera values in the order of the camera utility's inputs, and as the layers' own camera inputs.
  function cameraValues(cam, prefix) {
    var v = {};
    var names = prefix ? ["Ra", "Dec", "Fov", "Rotation", "Projection"] : ["centreRa", "centreDec", "fov", "rotation", "projection"];
    CAMERA_KEYS.forEach(function (k, i) { v[(prefix || "") + names[i]] = cam[k]; });
    return v;
  }
  function cleanCamera(cam) {
    var c = cam || {};
    return { ra: numberOr(c.ra, 83.8), dec: numberOr(c.dec, 0), fov: numberOr(c.fov, 60), rotation: numberOr(c.rotation, 0),
      projection: numberOr(c.projection, 0) };
  }

  // Sets the inputs named in `inputs` on a layer's array (generator.array for shapes, array for utilities).
  // A new layer already has slot 0, so a slot is only added when its index does not exist yet.
  function addInputs(id, arrayAttr, inputs, values) {
    for (var i = 0; i < inputs.length; i++) {
      var name = inputs[i][0], attr = arrayAttr + "." + i;
      if (!api.hasAttribute(id, attr)) api.addDynamic(id, arrayAttr, "double");
      try { api.renameAttribute(id, attr, name); } catch (e) { /* display name only */ }
      setOne(id, attr, values && values[name] !== undefined ? values[name] : inputs[i][1]);
    }
  }

  function compSize() { return A.readResolution(api.get(api.getActiveComp(), A.COMP_RESOLUTION_ATTR)); }

  // The camera's five values drive a sky layer's first five inputs, in the same order.
  function connectCamera(cameraId, targetId) {
    for (var i = 0; i < CAMERA_KEYS.length; i++) {
      api.connect(cameraId, A.CAMERA_ARRAY_ATTR + "." + i, targetId, A.SHAPE_ARRAY_ATTR + "." + i, true);
    }
  }

  function applyStyle(id, style) {
    api.setFill(id, !!style.fill);
    if (style.fill) setOne(id, A.FILL_COLOR_ATTR, A.COLOR_VALUE(style.fill));
    api.setStroke(id, !!style.stroke);
    if (style.stroke) {
      setOne(id, A.STROKE_COLOR_ATTR, A.COLOR_VALUE(style.stroke));
      setOne(id, A.STROKE_WIDTH_ATTR, style.width || 1);
    }
  }

  function cameraLayer(groupId, cam) {
    var id = api.create(A.CAMERA_LAYER_TYPE, NAMES.camera);
    setOne(id, A.CAMERA_EXPR_ATTR, E.writeTag("ASTRO_META", { category: "camera" }) + "\n" + E.cameraExpression());
    addInputs(id, A.CAMERA_ARRAY_ATTR, E.CAMERA_INPUTS, cameraValues(cam, ""));
    api.parent(id, groupId);
    return id;
  }

  function backgroundLayer(groupId, theme) {
    var s = compSize(), id = api.primitive("rectangle", NAMES.background);
    setOne(id, "generator.dimensions", [s.width, s.height]);
    applyStyle(id, { fill: theme.background });
    api.parent(id, groupId);
    return id;
  }

  // One javaScriptShape layer that draws a sky layer kind from its own data, with the camera connected.
  function skyShape(groupId, cameraId, name, kind, data, meta, cam, extra) {
    var id = api.create(A.SHAPE_LAYER_TYPE, name);
    var values = cameraValues(cam, "cam"), s = compSize();
    values.compW = s.width; values.compH = s.height;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) values[k] = extra[k];
    addInputs(id, A.SHAPE_ARRAY_ATTR, KIND_INPUTS[kind], values);
    setOne(id, A.SHAPE_EXPR_ATTR, E.layerExpression(ASTRO_SKY_SRC, kind, data, meta));
    connectCamera(cameraId, id);
    api.parent(id, groupId);
    return id;
  }

  // Each colour band's stars, in band order (empty bands stay empty).
  function starsByBand(stars) {
    var out = [];
    for (var b = 0; b < AstroStars.BANDS.length; b++) out.push({ ra: [], dec: [], mag: [] });
    for (var i = 0; i < stars.count; i++) {
      var g = out[AstroStars.bandOf(stars.bv[i])];
      g.ra.push(stars.ra[i]); g.dec.push(stars.dec[i]); g.mag.push(stars.mag[i]);
    }
    return out;
  }

  function glowStars(stars) {
    var g = { ra: [], dec: [], mag: [] };
    for (var i = 0; i < stars.count; i++) {
      if (!(stars.mag[i] < GLOW_MAG)) continue;
      g.ra.push(stars.ra[i]); g.dec.push(stars.dec[i]); g.mag.push(stars.mag[i]);
    }
    return g;
  }

  function linesData(cons) {
    var lines = [];
    cons.forEach(function (c) { (c.lines || []).forEach(function (l) { lines.push(l); }); });
    return { lines: lines };
  }

  function bordersData(cons) {
    var rings = [];
    cons.forEach(function (c) { (c.border || []).forEach(function (r) { rings.push(r); }); });
    return { rings: rings };
  }

  function namesData(cons, nameCase) {
    return { items: cons.map(function (c) {
      return [nameCase === "upper" ? String(c.name).toUpperCase() : String(c.name), c.centre[0], c.centre[1]];
    }) };
  }

  function glowBlur(groupId, glowId) {
    var blur = api.create("blurFilter", NAMES.glow + " blur");
    setOne(blur, "amount", { x: GLOW_BLUR, y: GLOW_BLUR });
    api.connect(blur, "id", glowId, "filters");
    api.parent(blur, groupId);
  }

  // The meta tag of a sky layer (its expression's ASTRO_META), or null.
  function metaOf(id) {
    return E.readTag(readExpr(id, A.SHAPE_EXPR_ATTR) || readExpr(id, A.CAMERA_EXPR_ATTR), "ASTRO_META");
  }

  // Makes a sky: the group, its Camera, and every layer, bottom first (each parented layer lands on top).
  // cam: { ra, dec, fov, rotation, projection }. themeName: a theme name or a theme object. Returns { groupId, cameraId, name }.
  function createSky(name, cam, themeName) {
    var theme = themeFor(themeName), c = cleanCamera(cam), data = skyData();
    var groupId = api.create("group", name);
    api.setUserData(groupId, SKY_KEY, { v: SKY_VERSION, theme: theme });
    var cameraId = cameraLayer(groupId, c);
    backgroundLayer(groupId, theme);
    var borders = skyShape(groupId, cameraId, NAMES.borders, "border", bordersData(data.cons), { category: "borders" }, c);
    applyStyle(borders, { stroke: theme.borders, width: theme.bordersWidth });
    setOne(borders, "hidden", true);
    var lines = skyShape(groupId, cameraId, NAMES.lines, "lines", linesData(data.cons), { category: "lines" }, c);
    applyStyle(lines, { stroke: theme.lines, width: theme.linesWidth });
    var glow = skyShape(groupId, cameraId, NAMES.glow, "stars", glowStars(data.stars), { category: "glow" }, c, { size: GLOW_SIZE });
    applyStyle(glow, { fill: AstroStyles.previewColors(theme).star });
    setOne(glow, "opacity", theme.glow * 100);
    glowBlur(groupId, glow);
    var colours = AstroStyles.starColours(theme), bands = starsByBand(data.stars);
    for (var b = 0; b < bands.length; b++) {
      if (!bands[b].ra.length) continue;
      var band = skyShape(groupId, cameraId, "Stars · band " + b, "stars", bands[b], { category: "stars", band: b }, c);
      applyStyle(band, { fill: colours[b] });
    }
    var names = skyShape(groupId, cameraId, NAMES.names, "texts", namesData(data.cons, theme.nameCase), { category: "names" }, c);
    applyStyle(names, { fill: theme.names });
    setOne(names, "hidden", true);
    if (typeof api.select === "function") api.select(groupId);
    return { groupId: groupId, cameraId: cameraId, name: name };
  }

  // The layers of a sky by part: background, bands (in band order), glow, lines, borders, names (ids or null).
  function skyLayers(s) {
    var out = { background: null, bands: [], glow: null, lines: null, borders: null, names: null };
    var bandIds = [];
    api.getChildren(s.groupId).forEach(function (id) {
      if (api.getNiceName(id) === NAMES.background) { out.background = id; return; }
      var m = metaOf(id);
      if (!m) return;
      if (m.category === "stars") bandIds[m.band] = id;
      else if (m.category === "glow") out.glow = id;
      else if (m.category === "lines") out.lines = id;
      else if (m.category === "borders") out.borders = id;
      else if (m.category === "names") out.names = id;
    });
    out.bands = bandIds.filter(function (id) { return !!id; });
    return out;
  }

  // Every sky in the active comp, found by the astroSky user data on its group.
  function findSkies() {
    var skies = [];
    api.getCompLayers(false).forEach(function (id) {
      var d = userData(id, SKY_KEY);
      if (!d || d.v !== SKY_VERSION) return;
      var cameraId = null;
      api.getChildren(id).forEach(function (child) {
        var m = metaOf(child);
        if (m && m.category === "camera") cameraId = child;
      });
      skies.push({ groupId: id, cameraId: cameraId, name: String(api.getNiceName(id)) });
    });
    return skies;
  }

  function themeOf(s) {
    var d = userData(s.groupId, SKY_KEY);
    return themeFor(d && d.theme ? d.theme : "Realistic");
  }
  function saveTheme(s, theme) { api.setUserData(s.groupId, SKY_KEY, { v: SKY_VERSION, theme: theme }); }

  // The camera's five values, as set by the panel.
  function readCamera(s) {
    function v(i) { return Number(api.get(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + i)); }
    return { ra: v(0), dec: v(1), fov: v(2), rotation: v(3), projection: Math.round(v(4)) };
  }

  function setCamera(s, cam) {
    var vals = cameraValues(cam, ""), o = {};
    E.CAMERA_INPUTS.forEach(function (inp, i) {
      if (vals[inp[0]] !== undefined) o[A.CAMERA_ARRAY_ATTR + "." + i] = vals[inp[0]];
    });
    api.set(s.cameraId, o);
  }

  // Sets one star input on every star layer (bands and glow); valueOf(id) gives each layer's value.
  function setStarInput(s, name, valueOf) {
    var L = skyLayers(s), ids = L.bands.concat(L.glow ? [L.glow] : []), idx = E.inputIndex(E.STAR_INPUTS, name);
    ids.forEach(function (id) { setOne(id, A.SHAPE_ARRAY_ATTR + "." + idx, valueOf(id)); });
  }

  function setDarkness(s, value) {
    var v = clamp(numberOr(value, 100), 0, 100);
    setStarInput(s, "darkness", function () { return v; });
  }

  // The bands and the glow are the star size; the glow is GLOW_SIZE times the bands.
  function setStarSize(s, value) {
    var v = numberOr(value, 1), L = skyLayers(s);
    setStarInput(s, "size", function (id) { return id === L.glow ? v * GLOW_SIZE : v; });
  }

  // True colours (on) or the theme's one star colour (off), kept in the sky's theme.
  function setStarColours(s, on) {
    var theme = themeOf(s);
    theme.starMode = on ? "true" : "mono";
    applyTheme(s, theme);
  }

  function setGlow(s, on) {
    var L = skyLayers(s);
    if (L.glow) setOne(L.glow, "opacity", on ? themeOf(s).glow * 100 : 0);
  }

  // Shows or hides one of the lines, borders or names.
  function setWholeSky(s, part, on) {
    if (PARTS.indexOf(part) < 0) throw new Error("Unknown sky part: " + part);
    var id = skyLayers(s)[part];
    if (id) setOne(id, "hidden", !on);
  }

  // An attribute is driven when it is keyframed or connected: the theme does not overwrite it.
  function isDriven(id, attr) {
    var keys = [], from = "";
    try { keys = api.getKeyframeTimes(id, attr) || []; } catch (e) { keys = []; }
    if (keys.length) return true;
    try { from = String(api.getInConnection(id, attr) || ""); } catch (e) { from = ""; }
    return from !== "";
  }

  // Writes a theme's colours and widths onto a sky. Attributes that are keyframed or connected are left alone and
  // counted in skipped (once per attribute). Returns { changed, skipped }. The theme is kept on the sky.
  function applyTheme(s, theme) {
    var t = themeFor(theme), L = skyLayers(s), colours = AstroStyles.starColours(t), seen = {};
    var tally = { changed: 0, skipped: 0 };
    function write(id, attr, value) {
      if (!id) return;
      var key = id + "|" + attr;
      if (seen[key]) return;
      seen[key] = true;
      if (isDriven(id, attr)) { tally.skipped++; return; }
      setOne(id, attr, value);
      tally.changed++;
    }
    write(L.background, A.FILL_COLOR_ATTR, A.COLOR_VALUE(t.background));
    write(L.lines, A.STROKE_COLOR_ATTR, A.COLOR_VALUE(t.lines));
    write(L.lines, A.STROKE_WIDTH_ATTR, t.linesWidth);
    write(L.borders, A.STROKE_COLOR_ATTR, A.COLOR_VALUE(t.borders));
    write(L.borders, A.STROKE_WIDTH_ATTR, t.bordersWidth);
    write(L.names, A.FILL_COLOR_ATTR, A.COLOR_VALUE(t.names));
    L.bands.forEach(function (id) {
      var m = metaOf(id);
      write(id, A.FILL_COLOR_ATTR, A.COLOR_VALUE(colours[m.band]));
    });
    write(L.glow, A.FILL_COLOR_ATTR, A.COLOR_VALUE(AstroStyles.previewColors(t).star));
    write(L.glow, "opacity", t.glow * 100);
    saveTheme(s, t);
    return tally;
  }

  return {
    createSky: createSky,
    findSkies: findSkies,
    skyLayers: skyLayers,
    readCamera: readCamera,
    setCamera: setCamera,
    setWholeSky: setWholeSky,
    setDarkness: setDarkness,
    setStarSize: setStarSize,
    setStarColours: setStarColours,
    setGlow: setGlow,
    applyTheme: applyTheme
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroScene;
