// Creates, connects and reads CavalryAstro's sky in Cavalry. Panel-only: uses `api`.
// A sky is a group holding a Camera utility, a background rectangle, one star layer per non-empty colour band,
// a glow (the bright stars, blurred), the constellation lines, borders and names. Every layer that draws the
// sky takes its camera from the Camera (the Cavalry Geo pattern). The group's user data astroSky holds its theme.
var AstroScene = (function () {
  var A = AstroAttrs;
  var E = AstroExpression;
  var SKY_KEY = "astroSky", SKY_VERSION = 1;
  // A layer's part is kept as its user data (the meta its expression carries), so lookups do not parse expressions.
  // The sky group keeps the record of the Spotlight: its id and the reveal amounts it was built from.
  var PART_KEY = "astroPart", SPOT_KEY = "astroSpotlight";
  var GLOW_MAG = 2.5, GLOW_SIZE = 3, GLOW_BLUR = 6;
  // Default text sizes of the whole-sky constellation names and of each reveal's star labels.
  var NAMES_TEXT_SIZE = 22, REVEAL_LABEL_TEXT_SIZE = 26;
  var PARTS = ["lines", "borders", "names"];
  var NAMES = { camera: "Camera", background: "Sky background", glow: "Star glow", glowLevel: "Star glow opacity",
    lines: "Constellation lines", borders: "Constellation borders", names: "Constellation names" };
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

  // Writes an input the way Cavalry reads it: an input fed from another layer's attribute (a Controls value, or a
  // camera input the sky layers read) takes the value at that source, since a write to the fed input itself has no
  // effect. The driver output "id" is not a value, so an input driven by one is written directly. Others are written directly.
  function writeInput(id, attr, value) {
    var from = "";
    try { from = String(api.getInConnection(id, attr) || ""); } catch (e) { from = ""; }
    var at = from.indexOf(".");
    if (at > 0 && from.slice(at + 1) !== A.DRIVER_OUTPUT_ATTR) { setOne(from.slice(0, at), from.slice(at + 1), value); return; }
    setOne(id, attr, value);
  }

  // Brings a sky's Controls up to date after a scene action (the panel script may load after this one: a missing panel is skipped).
  // Returns the panel's result, or null.
  function syncControls(s) {
    return typeof AstroControlPanel === "undefined" ? null : AstroControlPanel.sync(s);
  }

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
    tagPart(id, { category: "camera" });
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
  // opts are the layer kind's options (stars: ignoreLimit).
  function skyShape(groupId, cameraId, name, kind, data, meta, cam, extra, opts) {
    var id = api.create(A.SHAPE_LAYER_TYPE, name);
    var values = cameraValues(cam, "cam"), s = compSize();
    values.compW = s.width; values.compH = s.height;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) values[k] = extra[k];
    addInputs(id, A.SHAPE_ARRAY_ATTR, KIND_INPUTS[kind], values);
    setOne(id, A.SHAPE_EXPR_ATTR, E.layerExpression(ASTRO_SKY_SRC, kind, data, meta, opts));
    tagPart(id, meta);
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
      return [nameCase === "upper" ? String(c.latin).toUpperCase() : String(c.latin), c.centre[0], c.centre[1]];
    }) };
  }

  // A Fast Blur filter on a layer, in groupId, with the given amount.
  function blurLayer(groupId, targetId, name, amount) {
    var blur = api.create("blurFilter", name);
    setOne(blur, "amount", { x: amount, y: amount });
    api.connect(blur, "id", targetId, "filters");
    api.parent(blur, groupId);
    return blur;
  }

  function glowBlur(groupId, glowId) {
    blurLayer(groupId, glowId, NAMES.glow + " blur", GLOW_BLUR);
  }

  // Tags a layer with its part (the meta its expression carries). Lookups read the tag before the expression.
  function tagPart(id, meta) {
    if (meta && typeof api.setUserData === "function") api.setUserData(id, PART_KEY, meta);
  }

  // A JavaScript Utility in groupId: its expression, its inputs (name, default), their values and its part's meta.
  function utilityLayer(groupId, name, expr, inputs, values, meta) {
    var id = api.create(A.CAMERA_LAYER_TYPE, name);
    setOne(id, A.CAMERA_EXPR_ATTR, expr);
    addInputs(id, A.CAMERA_ARRAY_ATTR, inputs, values || {});
    api.parent(id, groupId);
    tagPart(id, meta);
    return id;
  }

  // The glow's opacity: a utility that scales the glow level (theme glow, or 0 when off) by the spotlight's share.
  // The glow is driven, so applyTheme and setGlow write the level, not the glow's opacity.
  function glowLevelLayer(groupId, glowId, level) {
    var id = utilityLayer(groupId, NAMES.glowLevel, E.glowLevelExpression({ category: "glowLevel" }), E.GLOW_LEVEL_INPUTS,
      { visible: 100, level: level }, { category: "glowLevel" });
    api.connect(id, A.DRIVER_OUTPUT_ATTR, glowId, "opacity", true);
    return id;
  }

  // The part of a sky layer: its tag, else the meta its expression carries (layers made before tags), or null.
  function metaOf(id) {
    var tag = userData(id, PART_KEY);
    if (tag && typeof tag === "object") return tag;
    return E.readTag(readExpr(id, A.SHAPE_EXPR_ATTR) || readExpr(id, A.CAMERA_EXPR_ATTR), "ASTRO_META");
  }

  // Makes a sky: the group, its Camera, and every layer, bottom first (each parented layer lands on top).
  // cam: { ra, dec, fov, rotation, projection }. themeName: a theme name or a theme object. Returns { groupId, cameraId, name }.
  function createSky(name, cam, themeName) {
    var theme = themeFor(themeName), c = cleanCamera(cam), data = skyData();
    var groupId = api.create("group", name);
    saveSky({ groupId: groupId }, theme, true);
    var cameraId = cameraLayer(groupId, c);
    backgroundLayer(groupId, theme);
    var borders = skyShape(groupId, cameraId, NAMES.borders, "border", bordersData(data.cons), { category: "borders" }, c);
    applyStyle(borders, { stroke: theme.borders, width: theme.bordersWidth });
    setOne(borders, "hidden", true);
    var lines = skyShape(groupId, cameraId, NAMES.lines, "lines", linesData(data.cons), { category: "lines" }, c);
    applyStyle(lines, { stroke: theme.lines, width: theme.linesWidth });
    var glow = skyShape(groupId, cameraId, NAMES.glow, "stars", glowStars(data.stars), { category: "glow" }, c, null, { sizeScale: GLOW_SIZE });
    applyStyle(glow, { fill: AstroStyles.previewColors(theme).star });
    glowBlur(groupId, glow);
    glowLevelLayer(groupId, glow, theme.glow * 100);
    var colours = AstroStyles.starColours(theme), bands = starsByBand(data.stars);
    for (var b = 0; b < bands.length; b++) {
      if (!bands[b].ra.length) continue;
      var band = skyShape(groupId, cameraId, "Stars · band " + b, "stars", bands[b], { category: "stars", band: b }, c);
      applyStyle(band, { fill: colours[b] });
    }
    var names = skyShape(groupId, cameraId, NAMES.names, "texts", namesData(data.cons, theme.nameCase), { category: "names" }, c, { textSize: NAMES_TEXT_SIZE });
    applyStyle(names, { fill: theme.names });
    setOne(names, "hidden", true);
    var made = { groupId: groupId, cameraId: cameraId, name: name }, ctl = syncControls(made);
    // The sky's Controls are what the user works in, so they are selected rather than the group.
    if (typeof api.select === "function") api.select([ctl && ctl.componentId ? ctl.componentId : groupId]);
    return made;
  }

  // The layers of a sky by part: background, bands (in band order), glow, lines, borders, names (ids or null).
  function skyLayers(s) {
    var out = { background: null, bands: [], glow: null, glowLevel: null, lines: null, borders: null, names: null, spotlight: null };
    var bandIds = [];
    api.getChildren(s.groupId).forEach(function (id) {
      if (api.getNiceName(id) === NAMES.background) { out.background = id; return; }
      var m = metaOf(id);
      if (!m) return;
      if (m.category === "stars") bandIds[m.band] = id;
      else if (m.category === "glow") out.glow = id;
      else if (m.category === "glowLevel") out.glowLevel = id;
      else if (m.category === "spotlight") out.spotlight = id;
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
  // The glow is on unless the user turned it off (glow: false); both settings live in the sky's user data.
  function glowOn(s) { var d = userData(s.groupId, SKY_KEY); return !(d && d.glow === false); }
  function saveSky(s, theme, glow) { api.setUserData(s.groupId, SKY_KEY, { v: SKY_VERSION, theme: theme, glow: glow !== false }); }

  // The theme the sky's layers show now, read live, so Controls tweaks count, named `name`. A value that is missing or
  // not a colour keeps the sky's stored theme. Star mode is mono when every band has one fill (its colour is that fill).
  // The reveal colours and widths come from the stored theme, as no reveal layer is read here.
  function readSkyTheme(s, name) {
    var base = themeOf(s), L = skyLayers(s), out = {}, bands = [];
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    // Cavalry returns a colour as {r, g, b, a}; AstroStyles.toHex makes it "#rrggbb". Not a colour: the fallback.
    function hexOr(id, attr, fallback) {
      if (!id) return fallback;
      return AstroStyles.toHex(api.get(id, attr)) || fallback;
    }
    function numOr(id, attr, fallback) {
      if (!id) return fallback;
      var n = Number(api.get(id, attr));
      return isFinite(n) ? n : fallback;
    }
    out.background = hexOr(L.background, A.FILL_COLOR_ATTR, base.background);
    out.lines = hexOr(L.lines, A.STROKE_COLOR_ATTR, base.lines);
    out.linesWidth = numOr(L.lines, A.STROKE_WIDTH_ATTR, base.linesWidth);
    out.borders = hexOr(L.borders, A.STROKE_COLOR_ATTR, base.borders);
    out.bordersWidth = numOr(L.borders, A.STROKE_WIDTH_ATTR, base.bordersWidth);
    out.names = hexOr(L.names, A.FILL_COLOR_ATTR, base.names);
    L.bands.forEach(function (id) { bands.push(hexOr(id, A.FILL_COLOR_ATTR, null)); });
    var mono = bands.length > 0 && bands.every(function (c) { return c !== null && c === bands[0]; });
    if (mono) { out.starMode = "mono"; out.starColour = bands[0]; }
    else if (bands.length) out.starMode = "true";
    // With the glow off the level reads 0, so the theme's own level is kept for when it is turned back on.
    if (L.glowLevel) out.glow = glowOn(s) ? numOr(L.glowLevel, A.CAMERA_ARRAY_ATTR + ".1", base.glow * 100) / 100 : base.glow;
    out.name = name;
    return AstroStyles.normalise(out);
  }
  // Stores a theme as the sky's theme (what Apply and the preview use), keeping the glow switch. Writes no layer.
  function setSkyTheme(s, theme) { saveSky(s, themeFor(theme), glowOn(s)); }

  // The camera's five values, as set by the panel.
  function readCamera(s) {
    function v(i) { return Number(api.get(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + i)); }
    return { ra: v(0), dec: v(1), fov: v(2), rotation: v(3), projection: Math.round(v(4)) };
  }

  function setCamera(s, cam) {
    var vals = cameraValues(cam, ""), o = {};
    E.CAMERA_INPUTS.forEach(function (inp, i) {
      if (vals[inp[0]] !== undefined) writeInput(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + i, vals[inp[0]]);
    });
  }

  // The reveal star layers of every reveal in the sky (their stars and their glow).
  function revealStarLayers(s) {
    var out = [];
    findReveals(s).forEach(function (r) {
      api.getChildren(r.groupId).forEach(function (k) {
        var m = metaOf(k);
        if (m && (m.category === "revealStars" || m.category === "revealGlow")) out.push(k);
      });
    });
    return out;
  }

  // Where the sky's star size comes from: the input a star layer reads it through ({id, attr}), or null when it is set
  // directly on the layers. A driver output is not a value, so it does not count.
  function starSizeSource(s) {
    var L = skyLayers(s), star = L.bands[0] || L.glow;
    if (!star) return null;
    var from = "";
    try { from = String(api.getInConnection(star, A.SHAPE_ARRAY_ATTR + "." + E.inputIndex(E.STAR_INPUTS, "size")) || ""); } catch (e) { from = ""; }
    var at = from.indexOf(".");
    if (at < 0 || from.slice(at + 1) === A.DRIVER_OUTPUT_ATTR) return null;
    return { id: from.slice(0, at), attr: from.slice(at + 1) };
  }

  // The whole-sky names layer's expression, with its constellation names in the case given.
  function namesExpression(nameCase) {
    return E.layerExpression(ASTRO_SKY_SRC, "texts", namesData(skyData().cons, nameCase), { category: "names" });
  }

  // Sets one star input on every star layer (bands and glow, and any extra ids); valueOf(id) gives each layer's value.
  function setStarInput(s, name, valueOf, extra) {
    var L = skyLayers(s), ids = L.bands.concat(L.glow ? [L.glow] : []).concat(extra || []), idx = E.inputIndex(E.STAR_INPUTS, name);
    ids.forEach(function (id) { writeInput(id, A.SHAPE_ARRAY_ATTR + "." + idx, valueOf(id)); });
  }

  function setDarkness(s, value) {
    var v = clamp(numberOr(value, 100), 0, 100);
    setStarInput(s, "darkness", function () { return v; });
  }

  // The bands and the glow share one size input. The glow draws at GLOW_SIZE times it (its layer's sizeScale).
  function setStarSize(s, value) {
    var v = numberOr(value, 1);
    setStarInput(s, "size", function () { return v; }, revealStarLayers(s));
  }

  // True colours (on) or the theme's one star colour (off), kept in the sky's theme.
  function setStarColours(s, on) {
    var theme = themeOf(s);
    theme.starMode = on ? "true" : "mono";
    applyTheme(s, theme);
  }

  function setGlow(s, on) {
    var L = skyLayers(s);
    saveSky(s, themeOf(s), !!on);
    if (L.glowLevel) writeInput(L.glowLevel, A.CAMERA_ARRAY_ATTR + ".1", on ? themeOf(s).glow * 100 : 0);
  }

  // Shows or hides one of the lines, borders or names.
  function setWholeSky(s, part, on) {
    if (PARTS.indexOf(part) < 0) throw new Error("Unknown sky part: " + part);
    var id = skyLayers(s)[part];
    if (id) writeInput(id, "hidden", !on);
  }

  // What the Stars tab shows for a sky: the darkness and size its star layers read, the colour and glow switches, and
  // whether the whole-sky lines, borders and names are shown. A part the sky lacks reads as its default.
  function readStars(s) {
    var L = skyLayers(s), star = L.bands[0] || L.glow;
    function starValue(name, fallback) {
      if (!star) return fallback;
      return numberOr(api.get(star, A.SHAPE_ARRAY_ATTR + "." + E.inputIndex(E.STAR_INPUTS, name)), fallback);
    }
    function shown(id) { return id ? !api.get(id, "hidden") : true; }
    return {
      darkness: starValue("darkness", 100), size: starValue("size", 1), starColours: themeOf(s).starMode === "true",
      glow: glowOn(s), lines: shown(L.lines), borders: shown(L.borders), names: shown(L.names)
    };
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
    // The whole-sky names are written in the theme's case, so a change of case rewrites their text.
    if (L.names && themeOf(s).nameCase !== t.nameCase) setOne(L.names, A.SHAPE_EXPR_ATTR, namesExpression(t.nameCase));
    var glow = glowOn(s);
    write(L.glowLevel, A.CAMERA_ARRAY_ATTR + ".1", glow ? t.glow * 100 : 0);
    saveSky(s, t, glow);
    return tally;
  }

  // ---- Camera moves ---------------------------------------------------------------------------------
  // A flight keys the Camera's centreRa, centreDec and fov for each frame of its range. Its record (the
  // astroFlights user data on the Camera) lets a later Update flight rebuild the same keys. Ported from Cavalry Geo.
  var FLIGHTS_KEY = "astroFlights", EXTEND_PAD_SECONDS = 3, DEFAULT_FPS = 25;
  var STAR_FOV = 20;
  var FLIGHT_ATTRS = [0, 1, 2].map(function (i) { return A.CAMERA_ARRAY_ATTR + "." + i; });

  // Runs fn with the playhead on frame, then puts the playhead back.
  function atFrame(frame, fn) {
    var back = api.getFrame();
    try { api.setFrame(frame); return fn(); } finally { api.setFrame(back); }
  }

  function compFrameRange() {
    var v = api.get(api.getActiveComp(), A.COMP_FRAME_RANGE_ATTR);
    if (Array.isArray(v)) return { start: Number(v[0]), end: Number(v[1]) };
    return { start: Number(v.x), end: Number(v.y) };
  }

  function compFps() {
    var f = Number(api.get(api.getActiveComp(), A.COMP_FPS_ATTR));
    return isFinite(f) && f > 0 ? f : DEFAULT_FPS;
  }

  // Sets the camera's centre and field of view at once, without keys.
  function jumpCamera(s, target) {
    setCamera(s, { ra: target.ra, dec: target.dec, fov: target.fov });
  }

  // The view a constellation is framed in: its centre is the spherical mean of its border points, and its fov is the
  // smallest that holds every border point and line vertex inside 85 % of the comp's width and height.
  var FRAME_SHARE = 0.85;
  function constellationFov(c, centre, compW, compH) {
    var pts = [];
    (c.border || []).forEach(function (ring) { ring.forEach(function (p) { pts.push(p); }); });
    (c.lines || []).forEach(function (line) { line.forEach(function (p) { pts.push(p); }); });
    return AstroSky.fitFov(pts, centre, compW, compH, FRAME_SHARE);
  }
  function constellationCentre(c) {
    var pts = [];
    (c.border || []).forEach(function (ring) { ring.forEach(function (p) { pts.push(p); }); });
    return pts.length ? AstroSky.mid(pts) : c.centre;
  }

  // A fly target: a constellation (index into the catalogue) or a star (index into the star list).
  // Returns { kind, index, label, ra, dec, fov }. A constellation's fov depends on the comp's size.
  function flyTarget(kind, index) {
    var data = skyData();
    if (kind === "constellation") {
      var c = data.cons[index];
      if (!c) throw new Error("No constellation at index " + index);
      var comp = compSize(), centre = constellationCentre(c);
      return { kind: kind, index: index, label: c.latin, ra: centre[0], dec: centre[1], fov: constellationFov(c, centre, comp.width, comp.height) };
    }
    if (kind === "star") {
      var st = data.stars;
      if (!(index >= 0 && index < st.count)) throw new Error("No star at index " + index);
      return { kind: kind, index: index, label: st.name[index] || st.bayer[index] || "Star", ra: st.ra[index], dec: st.dec[index], fov: STAR_FOV };
    }
    throw new Error("Unknown fly target: " + kind);
  }

  // Keys the camera along points (one per frame from startFrame, as AstroFly.path gives them). RA is unwrapped
  // so that no two consecutive keys sit 360 apart: the first key is nearest the camera's centreRa.
  // Keys already in the range are replaced. The seed is the camera's RA at startFrame (not at the playhead), so every
  // caller (flights, Update flight, Drift) unwraps from the same place. Returns { start, end }.
  function flyCamera(s, points, startFrame) {
    var end = startFrame + points.length - 1, prevRa = readCameraAt(s, startFrame).ra;
    if (!isFinite(prevRa)) prevRa = points[0].ra;
    FLIGHT_ATTRS.forEach(function (attr) {
      (api.getKeyframeTimes(s.cameraId, attr) || []).forEach(function (f) {
        if (f >= startFrame && f <= end) api.deleteKeyframe(s.cameraId, attr, f);
      });
    });
    points.forEach(function (p, k) {
      prevRa = AstroSky.nearestRa(p.ra, prevRa);
      var o = {};
      o[FLIGHT_ATTRS[0]] = prevRa; o[FLIGHT_ATTRS[1]] = p.dec; o[FLIGHT_ATTRS[2]] = p.fov;
      api.keyframe(s.cameraId, startFrame + k, o);
    });
    return { start: startFrame, end: end };
  }

  // Flies the camera from where it is at start to target, over frames start to end (end - start steps).
  // opts: { start, end, easing, arc } with AstroFly ids (defaults: smooth, normal). Keys the frames, and
  // remembers the flight. Returns { start, end }.
  function flyTo(s, target, opts) {
    var start = opts.start, end = opts.end, easing = opts.easing || "smooth", arc = opts.arc || "normal";
    return atFrame(start, function () {
      var b = readCamera(s), from = { ra: b.ra, dec: b.dec, fov: b.fov };
      var to = { ra: target.ra, dec: target.dec, fov: target.fov };
      var range = flyCamera(s, AstroFly.path(from, to, end - start, { easing: easing, arc: arc }), start);
      recordFlight(s, { start: start, end: end, from: from, to: to, target: target, easing: easing, arc: arc });
      return range;
    });
  }

  function readFlights(s) {
    var v = userData(s.cameraId, FLIGHTS_KEY);
    return Array.isArray(v) ? v : [];
  }

  // Remembers a flight on the Camera. A new record replaces any it overlaps; chained flights share one
  // boundary frame (0-20 then 20-40), which is not an overlap. A record over exactly the same frames keeps its place.
  function recordFlight(s, rec) {
    if (typeof api.setUserData !== "function") return;
    var all = readFlights(s), kept = all.filter(function (r) { return r.end <= rec.start || r.start >= rec.end; });
    var gone = all.filter(function (r) { return kept.indexOf(r) < 0; });
    if (gone.length === 1 && gone[0].start === rec.start && gone[0].end === rec.end) kept.splice(all.indexOf(gone[0]), 0, rec);
    else kept.push(rec);
    api.setUserData(s.cameraId, FLIGHTS_KEY, kept);
  }

  // The latest-made flight, or null.
  function lastFlight(s) {
    var all = readFlights(s);
    return all.length ? all[all.length - 1] : null;
  }

  // The latest-made flight whose range holds the frame, or null.
  function flightAt(s, frame) {
    var all = readFlights(s);
    for (var i = all.length - 1; i >= 0; i--) if (all[i].start <= frame && frame <= all[i].end) return all[i];
    return null;
  }

  // The camera's centre and fov at a frame.
  function readCameraAt(s, frame) {
    return atFrame(frame, function () { return readCamera(s); });
  }

  // Where a flight really begins: the end view of a remembered flight that finishes where this one starts (a chain),
  // else the camera as it is one frame before it, or the recorded start on the composition's first frame.
  function flightStart(s, rec) {
    var before = readFlights(s).filter(function (r) { return r.end === rec.start && r.start < rec.start; });
    if (before.length) {
      var p = before[before.length - 1].to;
      return { ra: p.ra, dec: p.dec, fov: p.fov };
    }
    if (rec.start > compFrameRange().start) {
      var c = readCameraAt(s, rec.start - 1);
      return { ra: c.ra, dec: c.dec, fov: c.fov };
    }
    return { ra: rec.from.ra, dec: rec.from.dec, fov: rec.from.fov };
  }

  // Lengthens the composition for a flight ending at newEnd: the new end is newEnd plus 3 seconds. The layers
  // that reached the old end move to the new end (a layer's out frame is one past its last frame), and so does
  // the play range when it reached the old end. Layers trimmed to end earlier are left alone.
  // Returns { oldEnd, newEnd, layers }, or null when the composition is already long enough.
  function extendComp(newEnd) {
    var comp = api.getActiveComp(), oldEnd = compFrameRange().end;
    var target = Math.round(newEnd + EXTEND_PAD_SECONDS * compFps());
    if (!(target > oldEnd)) return null;
    return { oldEnd: oldEnd, newEnd: target, layers: extendOne(comp, oldEnd, target) };
  }

  // Moves the layers that reached oldEnd, the comp's end and (when it reached oldEnd) its play range to newEnd.
  // Returns how many layers moved.
  function extendOne(comp, oldEnd, newEnd) {
    var layers = 0;
    if (typeof api.getOutFrame === "function" && typeof api.setOutFrame === "function") {
      api.getCompLayers(false).forEach(function (id) {
        try {
          if (Number(api.getOutFrame(id)) >= oldEnd) { api.setOutFrame(id, newEnd + 1); layers++; }
        } catch (e) { /* one layer that can't be extended never stops the rest */ }
      });
    }
    var playsToEnd = false;
    try { playsToEnd = Number(api.get(comp, A.COMP_PLAYBACK_END_ATTR)) >= oldEnd; } catch (e) { /* no play range to keep */ }
    var end = {};
    end[A.COMP_END_ATTR] = newEnd;
    api.set(comp, end);
    if (playsToEnd) { var play = {}; play[A.COMP_PLAYBACK_END_ATTR] = newEnd; api.set(comp, play); }
    return layers;
  }

  // ---- Reveals and spotlight (Task 9) ---------------------------------------------------------------
  // A reveal is a group inside its sky, above the sky's own layers. It holds the reveal amount (a utility keyed
  // 0 at the start and 100 at the end: the one source of truth), the stage utilities that turn the amount into
  // each part's value, and the parts. The sky's Spotlight dims the sky's layers by the largest reveal's spotlight.
  // Ported from Cavalry Geo's highlights (numbering, records on the group, rebuild in place).
  var REVEAL_KEY = "astroReveal", REVEALS_KEY = "astroReveals", REVEAL_VERSION = 1;
  var REVEAL_PARTS = ["lines", "border", "title", "labels"];
  var STAGE_NAMES = { border: "Reveal border opacity", lines: "Reveal lines draw", labels: "Reveal labels opacity",
    title: "Reveal title opacity" };
  var REVEAL_GLOW_BLUR = 8;
  var DEFAULT_SPOTLIGHT = 60, DEFAULT_CORNER = 1, DEFAULT_MARGIN = 60, DEFAULT_OFFSET_Y = 80;

  function pickNumber(v, fallback) {
    return v === undefined || v === null || !isFinite(Number(v)) ? fallback : Number(v);
  }

  // The parts asked for, in REVEAL_PARTS order. An unknown part throws.
  function chosenParts(parts) {
    var asked = parts || [];
    asked.forEach(function (p) { if (REVEAL_PARTS.indexOf(p) < 0) throw new Error("Unknown reveal part: " + p); });
    return REVEAL_PARTS.filter(function (p) { return asked.indexOf(p) >= 0; });
  }

  // The name a title or reveal shows: the theme's case.
  function caseName(name, nameCase) {
    return nameCase === "upper" ? String(name).toUpperCase() : String(name);
  }

  // A reveal's record on its group, or null for a group that is not a reveal.
  function revealRecord(groupId) {
    var d = userData(groupId, REVEAL_KEY);
    return d && d.v === REVEAL_VERSION ? d : null;
  }
  function setRecord(groupId, rec) { api.setUserData(groupId, REVEAL_KEY, rec); }

  // The reveal's amount utility (the child tagged revealAmount), or null.
  function revealAmountOf(groupId) {
    var found = null;
    api.getChildren(groupId).forEach(function (k) { var m = metaOf(k); if (m && m.category === "revealAmount") found = k; });
    return found;
  }

  // Every reveal group in the sky, by number (oldest first for equal numbers).
  // A reveal with no amount utility is broken (its amount was deleted by hand): it is not listed here, and
  // prepareReveals removes it.
  function findReveals(s) {
    var out = [];
    api.getChildren(s.groupId).forEach(function (g) {
      var rec = revealRecord(g), amountId = rec ? revealAmountOf(g) : null;
      if (!rec || !amountId) return;
      out.push({ groupId: g, number: pickNumber(rec.number, 0), con: rec.con, parts: rec.parts || [],
        amountId: amountId, name: String(api.getNiceName(g)) });
    });
    return out.sort(function (a, b) { return a.number - b.number; });
  }

  // The members of a reveal, by part (ids, or null when the part is not drawn), and the constellation's name.
  // The Controls read these: the border and its glow are the two rings the Border colour drives.
  function revealMembers(r) {
    var out = { constellation: "", lines: null, border: null, borderGlow: null, labels: null, title: null };
    var rec = revealRecord(r.groupId);
    if (rec) out.constellation = rec.name;
    api.getChildren(r.groupId).forEach(function (k) {
      var m = metaOf(k);
      if (m && m.category === "revealLines") out.lines = k;
      else if (m && m.category === "revealBorder") out.border = k;
      else if (m && m.category === "revealBorderGlow") out.borderGlow = k;
      else if (m && m.category === "revealLabels") out.labels = k;
      else if (api.getNiceName(k) === "Title") out.title = k;
    });
    return out;
  }

  function highestNumber(s) {
    return findReveals(s).reduce(function (m, r) { return Math.max(m, r.number); }, 0);
  }

  // The sky a reveal group belongs to (its parent), with the sky's camera.
  function skyOfGroup(groupId) {
    var parent = api.getParent(groupId), cameraId = null;
    api.getChildren(parent).forEach(function (k) { var m = metaOf(k); if (m && m.category === "camera") cameraId = k; });
    return { groupId: parent, cameraId: cameraId, name: String(api.getNiceName(parent)) };
  }

  // The sky's reveal registry (its group ids), which prepareReveals checks for deleted groups.
  function registry(s) {
    var v = userData(s.groupId, REVEALS_KEY);
    return Array.isArray(v) ? v : [];
  }
  function register(s, groupId) {
    api.setUserData(s.groupId, REVEALS_KEY, registry(s).concat([groupId]));
  }

  // Connects a layer's output to one named input of a utility or shape (arrayAttr: "array" or "generator.array").
  function feedInput(fromId, fromAttr, toId, arrayAttr, inputs, name) {
    api.connect(fromId, fromAttr, toId, arrayAttr + "." + E.inputIndex(inputs, name), true);
  }

  // The constellation index of a constellation id, or -1.
  function conIndexOf(conId) {
    var cons = skyData().cons;
    for (var i = 0; i < cons.length; i++) if (cons[i].id === conId) return i;
    return -1;
  }

  // The members of a reveal, made in groupId: a stage utility per part, and the part's layers (lines, border with a
  // blur copy, one star layer per band present, labels, title with its position). Each part is driven by its stage.
  function buildMembers(s, groupId, c, parts, amountId) {
    var theme = themeOf(s), cam = readCamera(s), data = skyData(), cw = compSize(), colours = AstroStyles.starColours(theme);
    function stage(part) {
      var id = utilityLayer(groupId, STAGE_NAMES[part], E.stageExpression(ASTRO_REVEAL_SRC, part, { category: "revealStage", part: part }),
        E.STAGE_INPUTS, {}, { category: "revealStage", part: part });
      api.connect(amountId, A.CAMERA_ARRAY_ATTR + ".0", id, A.CAMERA_ARRAY_ATTR + ".0", true);
      return id;
    }
    // The border stage also fades the reveal's stars in, so it is always made.
    var borderId = stage("border");
    if (parts.indexOf("lines") >= 0) {
      var drawId = stage("lines");
      var lines = skyShape(groupId, s.cameraId, "Reveal lines", "lines", { lines: c.lines || [] }, { category: "revealLines" }, cam);
      applyStyle(lines, { stroke: theme.revealLines, width: theme.revealLinesWidth });
      feedInput(drawId, A.DRIVER_OUTPUT_ATTR, lines, A.SHAPE_ARRAY_ATTR, E.LINE_INPUTS, "draw");
    }
    if (parts.indexOf("border") >= 0) {
      ["Reveal border", "Reveal border glow"].forEach(function (name, k) {
        var ring = skyShape(groupId, s.cameraId, name, "border", { rings: c.border || [] }, { category: k ? "revealBorderGlow" : "revealBorder" }, cam);
        applyStyle(ring, { stroke: theme.revealBorder, width: theme.revealBorderWidth });
        api.connect(borderId, A.DRIVER_OUTPUT_ATTR, ring, "opacity", true);
        if (k) blurLayer(groupId, ring, name + " blur", REVEAL_GLOW_BLUR);
      });
    }
    // The reveal's stars: one layer per colour band the constellation's stars fall in, and a glow copy of its stars
    // brighter than GLOW_MAG (3 times the size, blurred, as the sky's glow). They ignore the darkness limit, so lines always
    // join stars. Their size is the sky's star size (the source its stars read, else the value now), and they fade in with
    // the border stage. The spotlight does not dim them.
    var bands = [], glowRows = { ra: [], dec: [], mag: [] };
    for (var b = 0; b < AstroStars.BANDS.length; b++) bands.push({ ra: [], dec: [], mag: [] });
    (c.stars || []).forEach(function (row) {
      var g = bands[AstroStars.bandOf(data.stars.bv[row])];
      g.ra.push(data.stars.ra[row]); g.dec.push(data.stars.dec[row]); g.mag.push(data.stars.mag[row]);
      if (data.stars.mag[row] < GLOW_MAG) {
        glowRows.ra.push(data.stars.ra[row]); glowRows.dec.push(data.stars.dec[row]); glowRows.mag.push(data.stars.mag[row]);
      }
    });
    var sizeFrom = starSizeSource(s), sizeAttr = A.SHAPE_ARRAY_ATTR + "." + E.inputIndex(E.STAR_INPUTS, "size"), sizeNow = readStars(s).size;
    function revealStarLayer(name, rows, meta, opts, fill) {
      var layer = skyShape(groupId, s.cameraId, name, "stars", rows, meta, cam, null, opts);
      applyStyle(layer, { fill: fill });
      if (sizeFrom) api.connect(sizeFrom.id, sizeFrom.attr, layer, sizeAttr, true);
      else setOne(layer, sizeAttr, sizeNow);
      api.connect(borderId, A.DRIVER_OUTPUT_ATTR, layer, "opacity", true);
      return layer;
    }
    bands.forEach(function (g, band) {
      if (!g.ra.length) return;
      revealStarLayer("Reveal stars · band " + band, g, { category: "revealStars", band: band }, { ignoreLimit: true }, colours[band]);
    });
    if (glowRows.ra.length) {
      var glow = revealStarLayer("Reveal star glow", glowRows, { category: "revealGlow" }, { ignoreLimit: true, sizeScale: GLOW_SIZE },
        AstroStyles.previewColors(theme).star);
      blurLayer(groupId, glow, "Reveal star glow blur", GLOW_BLUR);
    }
    if (parts.indexOf("labels") >= 0) {
      var labelId = stage("labels");
      var items = [];
      (c.stars || []).forEach(function (row) {
        var text = AstroStars.labelText(data.stars.name[row], data.stars.bayer[row], c.id, "bayer");
        if (text) items.push([text, data.stars.ra[row], data.stars.dec[row]]);
      });
      var labels = skyShape(groupId, s.cameraId, "Reveal labels", "texts", { items: items }, { category: "revealLabels" }, cam, { textSize: REVEAL_LABEL_TEXT_SIZE });
      applyStyle(labels, { fill: theme.revealLabels });
      api.connect(labelId, A.DRIVER_OUTPUT_ATTR, labels, "opacity", true);
    }
    if (parts.indexOf("title") >= 0) {
      var titleId = stage("title");
      var pos = utilityLayer(groupId, "Reveal title position", E.titlePositionExpression(ASTRO_REVEAL_SRC, { category: "revealTitle" }, caseName(c.latin, theme.nameCase).length),
        E.TITLE_INPUTS, { conRa: c.centre[0], conDec: c.centre[1], compW: cw.width, compH: cw.height }, { category: "revealTitle" });
      ["titleMode", "corner", "margin", "offsetY"].forEach(function (n) {
        api.connect(amountId, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.REVEAL_INPUTS, n),
          pos, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.TITLE_INPUTS, n), true);
      });
      [["camRa", 0], ["camDec", 1], ["camFov", 2], ["camRotation", 3]].forEach(function (p) {
        api.connect(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + p[1], pos, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.TITLE_INPUTS, p[0]), true);
      });
      var title = api.create(A.TEXT_LAYER_TYPE, "Title");
      setOne(title, A.TEXT_ATTR, caseName(c.latin, theme.nameCase));
      applyStyle(title, { fill: theme.title });
      api.connect(pos, A.DRIVER_OUTPUT_ATTR, title, "position", true);
      api.connect(titleId, A.DRIVER_OUTPUT_ATTR, title, "opacity", true);
      // Centred in every mode (Cavalry cannot drive the alignment). The position offsets a side corner by half the title's
      // width, and reads the title's font size, so a change of size moves it.
      setOne(title, A.TEXT_ALIGN_ATTR, 1);
      // The box hugs its text: a fixed 600 px box centres the text about 300 px right of the position.
      api.set(title, { autoWidth: true, autoHeight: true });
      api.connect(title, "fontSize", pos, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.TITLE_INPUTS, "fontSize"), true);
      api.parent(title, groupId);
    }
  }

  // Sets the reveal's amount settings the panel changed (spotlight, titleMode, corner, margin, offsetY).
  function setAmountSettings(amountId, o) {
    ["spotlight", "titleMode", "corner", "margin", "offsetY"].forEach(function (n) {
      if (o[n] === undefined) return;
      writeInput(amountId, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.REVEAL_INPUTS, n), Number(o[n]));
    });
  }

  // Makes a reveal of constellation conIndex in sky s: its amount keyed 0 at start and 100 at start + frames.
  // parts: which of REVEAL_PARTS to draw (the stars always are). opts: { titleMode: 0 Header or 1 Follows,
  // spotlight, corner, margin, offsetY }. Returns { groupId, number }.
  function createReveal(s, conIndex, parts, start, frames, opts) {
    var c = skyData().cons[conIndex];
    if (!c) throw new Error("No constellation at index " + conIndex);
    var o = opts || {}, chosen = chosenParts(parts);
    var first = Math.round(pickNumber(start, 0)), len = Math.max(1, Math.round(pickNumber(frames, 1)));
    var number = highestNumber(s) + 1;
    var groupId = api.create("group", "Reveal " + number + ": " + c.latin);
    setRecord(groupId, { v: REVEAL_VERSION, con: c.id, name: c.latin, parts: chosen, number: number });
    api.parent(groupId, s.groupId);
    var amountId = utilityLayer(groupId, "Reveal amount", E.revealAmountExpression({ category: "revealAmount" }), E.REVEAL_INPUTS, {
      spotlight: pickNumber(o.spotlight, DEFAULT_SPOTLIGHT), titleMode: pickNumber(o.titleMode, 0),
      corner: pickNumber(o.corner, DEFAULT_CORNER), margin: pickNumber(o.margin, DEFAULT_MARGIN), offsetY: pickNumber(o.offsetY, DEFAULT_OFFSET_Y)
    }, { category: "revealAmount" });
    api.keyframe(amountId, first, { "array.0": 0 });
    api.keyframe(amountId, first + len, { "array.0": 100 });
    buildMembers(s, groupId, c, chosen, amountId);
    register(s, groupId);
    refreshSpotlight(s);
    syncControls(s);
    return { groupId: groupId, number: number };
  }

  // Rebuilds a reveal in place: the same group, number, name and amount keys. Its parts are replaced by the ones
  // asked for; opts may change the amount's settings. Returns { groupId, number }.
  function changeReveal(groupId, parts, opts) {
    var rec = revealRecord(groupId);
    if (!rec) throw new Error("Not a reveal: " + groupId);
    var c = skyData().cons[conIndexOf(rec.con)];
    if (!c) throw new Error("The constellation of this reveal is not in the sky data.");
    var s = skyOfGroup(groupId), amountId = revealAmountOf(groupId), chosen = chosenParts(parts);
    // Checked before anything is deleted: without its amount the reveal cannot be rebuilt.
    if (!amountId) throw new Error("This reveal has no amount utility, so it cannot be changed. Delete it and make it again.");
    api.getChildren(groupId).forEach(function (k) { if (k !== amountId) api.deleteLayer(k); });
    if (amountId) setAmountSettings(amountId, opts || {});
    buildMembers(s, groupId, c, chosen, amountId);
    rec.parts = chosen;
    setRecord(groupId, rec);
    refreshSpotlight(s);
    syncControls(s);
    return { groupId: groupId, number: rec.number };
  }

  // (Re)builds the Spotlight utility in the sky group from the reveals now in it, and connects it: the whole-sky
  // layers' opacity becomes 100 minus the spotlight dim, and the glow level is scaled by the same visible share.
  // The old Spotlight is replaced, and every driven layer is connected again, so none keeps a stale dim.
  function refreshSpotlight(s) {
    var L = skyLayers(s), reveals = findReveals(s);
    if (L.spotlight) api.deleteLayer(L.spotlight);
    var spot = utilityLayer(s.groupId, "Spotlight", E.spotlightExpression(ASTRO_REVEAL_SRC, reveals.length, { category: "spotlight" }),
      E.spotlightInputs(reveals.length), {}, { category: "spotlight" });
    api.setUserData(s.groupId, SPOT_KEY, { spot: spot, amounts: reveals.map(function (r) { return r.amountId; }) });
    reveals.forEach(function (r, k) {
      api.connect(r.amountId, A.CAMERA_ARRAY_ATTR + ".0", spot, A.CAMERA_ARRAY_ATTR + "." + (2 * k), true);
      api.connect(r.amountId, A.CAMERA_ARRAY_ATTR + ".1", spot, A.CAMERA_ARRAY_ATTR + "." + (2 * k + 1), true);
    });
    L.bands.concat([L.lines, L.borders, L.names]).forEach(function (id) {
      if (id) api.connect(spot, A.DRIVER_OUTPUT_ATTR, id, "opacity", true);
    });
    if (L.glowLevel) api.connect(spot, A.DRIVER_OUTPUT_ATTR, L.glowLevel, A.CAMERA_ARRAY_ATTR + ".0", true);
    // The photo dims with the sky: its opacity utility takes the same visible share.
    imageryGroups(s).forEach(function (g) {
      var im = imageryParts(g);
      if (im.opacityId) api.connect(spot, A.DRIVER_OUTPUT_ATTR, im.opacityId, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.IMAGERY_OPACITY_INPUTS, "spotVisible"), true);
    });
    return spot;
  }

  // Gives the reveals a number each (oldest first): a duplicate number takes the highest + 1, and the group is renamed.
  // Returns how many reveals were given a new number.
  function renumber(reveals) {
    var top = 0, seen = {}, renamed = 0;
    reveals.forEach(function (r) { top = Math.max(top, r.number); });
    reveals.forEach(function (r) {
      if (r.number && !seen[r.number]) { seen[r.number] = true; return; }
      top += 1; seen[top] = true;
      var rec = revealRecord(r.groupId);
      if (!rec) return;
      rec.number = top;
      setRecord(r.groupId, rec);
      renamed++;
      if (typeof api.rename === "function") { try { api.rename(r.groupId, "Reveal " + top + ": " + rec.name); } catch (e) { /* cosmetic */ } }
    });
    return renamed;
  }

  // True when the Spotlight was built from exactly these reveals' amounts, and still exists.
  function spotlightUpToDate(s, reveals) {
    var rec = userData(s.groupId, SPOT_KEY), L = skyLayers(s);
    if (!L.spotlight || !rec || rec.spot !== L.spotlight) return false;
    return JSON.stringify(rec.amounts) === JSON.stringify(reveals.map(function (r) { return r.amountId; }));
  }

  // Drops the reveals whose group is gone, renumbers the rest, and rebuilds the Spotlight and the Controls when something
  // changed (a reveal dropped or renumbered, or the Spotlight not built from these reveals). The panel calls this on every
  // press, so an unchanged sky is left alone. Returns how many were dropped.
  // A reveal whose group is still there but whose amount is gone is broken: its members and then its group are deleted.
  function prepareReveals(s) {
    var live = api.getChildren(s.groupId), ids = registry(s), kept = [], removed = 0;
    ids.forEach(function (g) {
      if (live.indexOf(g) < 0) { removed++; return; }
      if (!revealAmountOf(g)) {
        api.getChildren(g).forEach(function (k) { api.deleteLayer(k); });
        if (!api.getChildren(g).length) api.deleteLayer(g);
        removed++;
        return;
      }
      kept.push(g);
    });
    if (removed) api.setUserData(s.groupId, REVEALS_KEY, kept);
    var reveals = findReveals(s), renamed = renumber(reveals);
    if (removed || renamed || !spotlightUpToDate(s, reveals)) {
      refreshSpotlight(s);
      syncControls(s);
    }
    return removed;
  }

  // ---- Imagery (Task 5) ---------------------------------------------------------------------------
  // The NASA Deep Star Maps photo, bent onto the camera with the Reproject filter (Cavalry Geo's bent imagery, local tiles
  // only). The photo is a source comp, SOURCE_PX square, holding a View group and one group per level. The View's position
  // and scale are driven from the camera (AstroReproject.viewFor), and each tile is a footage layer in the View's frame,
  // which is in degrees: its centre is its RA (unwrapped by j turns, so a copy beside the 0/360 seam sits where the camera
  // needs it) and its Dec. The sky's group holds one Composition Reference to the source comp, the Reproject filter and the
  // photo's opacity utility. The source comp's centre is 0,0, so a point at uncentred source px p sits at p - SOURCE_PX / 2.
  var IMAGERY_TYPE = "cavalryAstro::reproject";
  var REPROJECT_MISSING = "Imagery needs the CavalryAstro plugin: drag the CavalryAstro_plugin folder from the download into the Cavalry window once, then press Build imagery again.";
  var PACK_MISSING = "Imagery needs the imagery pack: download CavalryAstro-imagery.zip from the CavalryAstro releases page, unzip it and merge its CavalryAstro_assets folder into the one in your Scripts folder (Help → Show Scripts Folder), then press Build imagery again.";
  var IMAGERY_GROUP_NAME = "Imagery: NASA Deep Star Maps", IMAGERY_SOURCE_PREFIX = "Imagery source: NASA Deep Star Maps · ";
  var IMAGERY_ASSET_PREFIX = "CavalryAstro imagery · ", IMAGERY_KEY = "astroImagery", IMAGERY_VERSION = 1;
  var IMAGERY_VIEW_NAME = "View", IMAGERY_REF_NAME = "Imagery source", IMAGERY_FILTER_NAME = "CavalryAstro Reproject", IMAGERY_OPACITY_NAME = "Imagery opacity";
  var IMAGERY_VIEW_DRIVERS = [["position", "Imagery driver: View position"], ["scale", "Imagery driver: View scale"],
    ["viewScale", "Imagery driver: filter view scale"], ["viewOffset", "Imagery driver: filter view offset"]];
  var IMAGERY_CAMERA_FILTER_ATTRS = ["camRa", "camDec", "camFov", "camRotation"];
  var IMAGERY_STEP_FRAMES = 5, IMAGERY_STEP_MS = 1000, IMAGERY_TICK_MS = 20;
  // Each tile is drawn 2 px bigger on each side (1028 over 1024), which hides hairline seams between tiles.
  var IMAGERY_SEAM = 1028 / 1024;
  var SOURCE_PX = AstroReproject.SOURCE_PX, SOURCE_HALF = SOURCE_PX / 2;

  function identity() { return { "position.x": 0, "position.y": 0, "rotation.z": 0, "scale.x": 1, "scale.y": 1 }; }
  function setHidden(id, hidden) { api.set(id, { hidden: !!hidden }); }

  // Whether this Cavalry has a layer type installed (a plugin's type name).
  function layerTypeAvailable(type) {
    if (typeof api.getAllLayerTypes !== "function") return false;
    var types = [];
    try { types = api.getAllLayerTypes(true) || []; } catch (e) { return false; }
    for (var i = 0; i < types.length; i++) if (types[i] && types[i].type === type) return true;
    return false;
  }
  function reprojectAvailable() { return layerTypeAvailable(IMAGERY_TYPE); }

  // Whether the level 0 tiles are on disk (the pack's minimum): { ok, missing: paths }.
  function imageryPackAvailable() {
    var g = AstroImagery.LEVELS[0], missing = [];
    for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) {
      var p = AstroImagery.tilePath(A.ASSETS_DIR(), 0, r, c);
      if (!api.filePathExists(p)) missing.push(p);
    }
    return { ok: missing.length === 0, missing: missing };
  }

  function imageryPath(t) { return AstroImagery.tilePath(A.ASSETS_DIR(), t.L, t.row, t.col); }

  // Runs fn with compId active and makes `back` active again however it ends.
  function withComp(compId, back, fn) {
    if (api.getActiveComp() === compId) return fn();
    api.setActiveComp(compId);
    try { return fn(); } finally { api.setActiveComp(back); }
  }

  // A new source comp, SOURCE_PX square and see-through, with the map comp's frame range and frame rate. The map comp is
  // active again when this returns or throws; onMade gets the id as soon as the comp exists, so a failure can still delete it.
  function createSourceComp(name, mapComp, onMade) {
    var range = compFrameRange(), fps = null, comp, o = {};
    try { fps = Number(api.get(mapComp, A.COMP_FPS_ATTR)); } catch (e) { fps = null; }
    try { comp = api.createComp(name); onMade(comp); } finally { api.setActiveComp(mapComp); }
    o[A.COMP_RESOLUTION_ATTR] = { x: SOURCE_PX, y: SOURCE_PX };
    o[A.COMP_BACKGROUND_ATTR] = { r: 0, g: 0, b: 0, a: 0 };
    api.set(comp, o);
    setOne(comp, A.COMP_END_ATTR, range.end);
    setOne(comp, A.COMP_START_ATTR, range.start);
    if (fps > 0) setOne(comp, A.COMP_FPS_ATTR, fps);
    return comp;
  }

  // The imagery asset group of the sky (found by name, or made), or null when this Cavalry can't group assets.
  function findAssetGroup(name) {
    if (typeof api.getAssetWindowLayers !== "function" || typeof api.getLayerType !== "function") return null;
    var ids = [];
    try { ids = api.getAssetWindowLayers(true) || []; } catch (e) { ids = []; }
    for (var i = 0; i < ids.length; i++) {
      try { if (String(api.getLayerType(ids[i])) === "assetGroup" && String(api.getNiceName(ids[i])) === name) return ids[i]; } catch (e) { /* not a group */ }
    }
    return null;
  }
  function imageryAssetGroup(s) {
    try {
      if (typeof api.createAssetGroup !== "function" || typeof api.parent !== "function" || typeof api.getParent !== "function") return null;
      var name = IMAGERY_ASSET_PREFIX + s.name;
      return findAssetGroup(name) || api.createAssetGroup(name);
    } catch (e) { return null; }
  }
  // Moves the top-level ones among ids into group. Assets are never deleted, only filed.
  function fileInAssetGroup(ids, group) {
    if (!group) return;
    ids.forEach(function (id) {
      try { if (String(api.getParent(id)) === "") api.parent(id, group); } catch (e) { /* stays where it is */ }
    });
  }

  // The imagery groups of the sky (the newest first, as Cavalry lists children): the photo, and any it replaces while it builds.
  function imageryGroups(s) {
    return api.getChildren(s.groupId).filter(function (id) { var m = metaOf(id); return !!m && m.category === "imagery"; });
  }
  function childOf(groupId, pred) {
    var out = null;
    api.getChildren(groupId).forEach(function (k) { if (!out && pred(k)) out = k; });
    return out;
  }
  // The parts of a photo: its group, source comp, reference, filter and opacity utility (ids, or null).
  function imageryParts(groupId) {
    var rec = userData(groupId, IMAGERY_KEY);
    return {
      groupId: groupId, sourceComp: rec && rec.sourceComp ? rec.sourceComp : null,
      refId: childOf(groupId, function (k) { return String(api.getLayerType(k)) === "compReference"; }),
      filterId: childOf(groupId, function (k) { return String(api.getLayerType(k)) === IMAGERY_TYPE; }),
      opacityId: childOf(groupId, function (k) { var m = metaOf(k); return !!m && m.category === "imageryOpacity"; })
    };
  }
  // The sky's photo, or null.
  function findImagery(s) {
    var g = imageryGroups(s)[0];
    return g ? imageryParts(g) : null;
  }

  // The copies of each planned tile: its own (j = 0), and one for each turn of RA whose copy meets a sampled view's RA box.
  function placementsOf(items, samples, size) {
    var windows = samples.map(function (cam) { return AstroReproject.viewFor(cam, size.width, size.height); });
    var out = [];
    items.forEach(function (t) {
      var b = AstroImagery.tileBox(t.L, t.row, t.col), js = { 0: true };
      windows.forEach(function (v) {
        for (var j = Math.ceil((v.ra0 - b.ra1) / 360); j <= Math.floor((v.ra1 - b.ra0) / 360); j++) js[j] = true;
      });
      Object.keys(js).map(Number).sort(function (x, y) { return x - y; }).forEach(function (j) {
        out.push({ L: t.L, row: t.row, col: t.col, j: j });
      });
    });
    return out;
  }

  // The tiles the sky's camera needs: the camera every IMAGERY_STEP_FRAMES frames over the comp, plus the last frame.
  // Returns AstroImagery.planTiles' { items, capped, count } with placements (the copies) and warn (or null).
  function planImagery(s) {
    if (!reprojectAvailable()) throw new Error(REPROJECT_MISSING);
    var size = compSize(), range = compFrameRange(), samples = [], last = null;
    for (var f = range.start; f <= range.end; f += IMAGERY_STEP_FRAMES) { samples.push(readCameraAt(s, f)); last = f; }
    if (range.end >= range.start && last !== range.end) samples.push(readCameraAt(s, range.end));
    if (!samples.length) samples.push(readCamera(s));
    var plan = AstroImagery.planTiles(samples, size.width, size.height);
    plan.placements = placementsOf(plan.items, samples, size);
    plan.warn = plan.count > AstroImagery.WARN_TILES ? "This flight needs " + plan.count + " imagery tiles, so the build will be slow." : null;
    return plan;
  }

  // A tile copy's centre and layer scale in the View's frame (degrees; RA unwrapped by j turns), from its image's real
  // resolution res. The View maps the frame onto the source comp, so the tile lands where AstroReproject.tileLocal puts it.
  function tileFrame(p, res) {
    var b = AstroImagery.tileBox(p.L, p.row, p.col);
    return { x: (b.ra0 + b.ra1) / 2 + 360 * p.j, y: (b.dec0 + b.dec1) / 2,
      sx: (b.ra1 - b.ra0) / res.x * IMAGERY_SEAM, sy: (b.dec1 - b.dec0) / res.y * IMAGERY_SEAM };
  }

  // Runs a job's units in timer steps: each step runs units until its budget is used (always at least one). A unit
  // that throws ends the job (job.fail, then onDone({ ok: false, error })). Returns { cancel() }.
  function runJob(job, budgetMs, onProgress, onDone) {
    var timer = null, finished = false;
    function finish(r) { if (finished) return; finished = true; if (timer) timer.stop(); onDone(r); }
    function tick() {
      if (finished) return;
      var start = Date.now(), first = true;
      try {
        while (!job.done() && (first || Date.now() - start < budgetMs)) { first = false; job.unit(); }
      } catch (e) {
        if (job.fail) job.fail(e);
        finish({ ok: false, error: e && e.message ? e.message : String(e) });
        return;
      }
      if (onProgress) onProgress(job.progress());
      if (job.done()) finish(job.result());
    }
    timer = new api.Timer({ onTimeout: tick });
    timer.setRepeating(true);
    timer.setInterval(IMAGERY_TICK_MS);
    timer.start();
    return { cancel: function () { return job.cancel ? job.cancel() : false; } };
  }

  // The Camera's five values feed a utility's inputs (its array), in the same order.
  function feedCamera(cameraId, utilId) {
    for (var i = 0; i < CAMERA_KEYS.length; i++) api.connect(cameraId, A.CAMERA_ARRAY_ATTR + "." + i, utilId, A.CAMERA_ARRAY_ATTR + "." + i, true);
  }

  // The photo's values a rebuild keeps: Imagery · Opacity (the utility's opacity), Brightness (the filter's gain) and Hide.
  function carriedImagery(im) {
    var o = im.opacityId ? Number(api.get(im.opacityId, A.CAMERA_ARRAY_ATTR + ".0")) : 100;
    var g = im.filterId ? Number(api.get(im.filterId, "gain")) : 1;
    return { opacity: isFinite(o) ? o : 100, gain: isFinite(g) ? g : 1, hidden: !!api.get(im.groupId, "hidden") };
  }

  // The photo's layers, in the order they come down: the source comp's footage, then its groups (the level groups and View),
  // then the photo's group (its reference, filter and utility go with it), then the source comp itself. Each is one step.
  function teardownEntries(im, mapComp) {
    var out = [];
    if (im.sourceComp && layerThere(im.sourceComp)) {
      withComp(im.sourceComp, mapComp, function () {
        var kids = api.getCompLayers(false);
        kids.filter(function (id) { return String(api.getLayerType(id)) === "footage"; }).forEach(function (id) { out.push({ id: id, comp: im.sourceComp }); });
        kids.filter(function (id) { return String(api.getLayerType(id)) !== "footage"; }).forEach(function (id) { out.push({ id: id, comp: im.sourceComp }); });
      });
    }
    if (im.groupId && layerThere(im.groupId)) out.push({ id: im.groupId });
    if (im.sourceComp && layerThere(im.sourceComp)) out.push({ comp: im.sourceComp });
    return out;
  }
  function layerThere(id) { return typeof api.layerExists !== "function" || api.layerExists(id); }
  function deleteIfThere(id) { if (layerThere(id)) api.deleteLayer(id); }
  // One layer (or comp) of a photo taken down. A layer that is already gone is skipped.
  function removeEntry(e, mapComp) {
    try {
      if (!e.id) { api.deleteLayer(e.comp); return; }
      if (e.comp) withComp(e.comp, mapComp, function () { deleteIfThere(e.id); });
      else deleteIfThere(e.id);
    } catch (x) { /* already gone */ }
  }

  // Puts the photo above the sky's stars (bands and glow) and below its lines, borders, names and reveals: the group is
  // raised, then the lines, borders, names and each reveal, in that order, so they stay above it. The selection is restored.
  function stackImagery(s, groupId) {
    if (typeof api.bringToFront !== "function" || typeof api.select !== "function") return;
    var L = skyLayers(s), previous = [];
    try { previous = api.getSelection(); } catch (e) { previous = []; }
    function raise(id) { if (id) { api.select([id]); api.bringToFront(); } }
    try {
      raise(groupId);
      [L.lines, L.borders, L.names].concat(findReveals(s).map(function (r) { return r.groupId; })).forEach(raise);
    } finally { try { api.select(previous); } catch (e) { /* cosmetic */ } }
  }

  // Puts id directly above other (in the same parent) by stepping id down the stack; the other layers keep their order.
  // Does nothing when other is not below id's place (it can only step down).
  function placeAbove(id, other) {
    if (typeof api.moveBackward !== "function" || typeof api.select !== "function") return;
    var parent = api.getParent(id), previous = [];
    try { previous = api.getSelection(); } catch (e) { previous = []; }
    try {
      for (var n = 0; n < 1000; n++) {
        var kids = api.getChildren(parent), i = kids.indexOf(id), o = kids.indexOf(other);
        if (i < 0 || o < 0 || i >= o || i === o - 1) return;
        api.select([id]);
        api.moveBackward();
      }
    } finally { try { api.select(previous); } catch (e) { /* cosmetic */ } }
  }

  // The message the build reports when it is done.
  function doneMessage(built, missing) {
    var msg = "Imagery built: " + built + " tile" + (built === 1 ? "" : "s") + ".";
    if (missing) msg += " " + missing + (missing === 1 ? " tile was" : " tiles were") + " missing and skipped.";
    return msg;
  }

  // Builds the sky's photo from a plan (planImagery). Refused before anything is made when the plugin or the pack is
  // missing. The build runs in timer steps (about a second each; every asset loads in the first). The new photo is
  // complete before the old one is taken apart, a layer per step, and the Imagery rows are kept. A tile missing on disk is
  // skipped and counted. onProgress({ built, total, phase }) runs each step; onDone(result) runs once, with
  // { ok, groupId, tiles, missing, message } or { ok: false, error } (the new photo is removed; the old one is left alone).
  // opts.budgetMs is the step budget (for tests). Returns { cancel() }, which returns false once the new photo is complete.
  function beginImageryBuild(s, plan, onProgress, onDone, opts) {
    if (!reprojectAvailable()) throw new Error(REPROJECT_MISSING);
    if (!imageryPackAvailable().ok) throw new Error(PACK_MISSING);
    var budget = opts && opts.budgetMs !== undefined ? opts.budgetMs : IMAGERY_STEP_MS;
    var mapComp = api.getActiveComp(), size = compSize(), previous = imageryGroups(s).map(imageryParts);
    var keep = previous.length ? carriedImagery(previous[0]) : { opacity: 100, gain: 1, hidden: false };
    var queue = [], missingKeys = {}, assetOf = {}, levels = {}, levelOrder = [], next = 0, built = 0, unreadable = 0;
    plan.placements.forEach(function (p) {
      if (api.filePathExists(imageryPath(p))) queue.push(p);
      else missingKeys[p.L + "_" + p.row + "_" + p.col] = true;
    });
    queue.sort(function (a, b) { return (a.L - b.L) || (a.j - b.j) || (a.row - b.row) || (a.col - b.col); });
    var missing = Object.keys(missingKeys).length;
    var rec = { groupId: null, sourceComp: null, filterId: null }, view = null, filter = null, phase = "setup", pending = [];

    // Setup (the first step): every asset loads now, and the source comp, View, the photo's group, reference, filter and opacity.
    function setup() {
      queue.forEach(function (p) { var path = imageryPath(p); if (!assetOf[path]) assetOf[path] = api.loadAsset(path, false); });
      var assets = [];
      Object.keys(assetOf).forEach(function (k) { assets.push(assetOf[k]); });
      fileInAssetGroup(assets, imageryAssetGroup(s));
      rec.sourceComp = createSourceComp(IMAGERY_SOURCE_PREFIX + s.name, mapComp, function (c) { rec.sourceComp = c; });
      withComp(rec.sourceComp, mapComp, function () {
        view = api.create("group", IMAGERY_VIEW_NAME);
        api.set(view, identity());
        tagPart(view, { category: "imageryView" });
      });
      rec.groupId = api.create("group", IMAGERY_GROUP_NAME);
      api.parent(rec.groupId, s.groupId);
      api.set(rec.groupId, identity());
      setHidden(rec.groupId, true);
      tagPart(rec.groupId, { category: "imagery" });
      api.setUserData(rec.groupId, IMAGERY_KEY, { v: IMAGERY_VERSION, sourceComp: rec.sourceComp });
      var ref = api.createCompReference(rec.sourceComp);
      api.rename(ref, IMAGERY_REF_NAME);
      api.parent(ref, rec.groupId);
      api.set(ref, identity());
      tagPart(ref, { category: "imageryRef" });
      filter = api.create(IMAGERY_TYPE, IMAGERY_FILTER_NAME);
      api.set(filter, { frameW: size.width, gain: keep.gain, allowViewportClipping: false, samplingQuality: 1 });
      api.connect(filter, "id", ref, "filters");
      api.parent(filter, rec.groupId);
      IMAGERY_CAMERA_FILTER_ATTRS.forEach(function (attr, i) { api.connect(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + i, filter, attr, true); });
      rec.filterId = filter;
      rec.opacityId = utilityLayer(rec.groupId, IMAGERY_OPACITY_NAME, E.imageryOpacityExpression({ category: "imageryOpacity" }),
        E.IMAGERY_OPACITY_INPUTS, { opacity: keep.opacity }, { category: "imageryOpacity" });
      api.connect(rec.opacityId, A.DRIVER_OUTPUT_ATTR, ref, "opacity", true);
      rec.refId = ref;
    }

    // One tile copy: its asset as a footage layer in the source comp, in its level group, placed in the View's frame.
    function levelGroup(L) {
      if (!levels[L]) {
        var g = api.create("group", "z " + L);
        api.parent(g, view);
        api.set(g, identity());
        tagPart(g, { category: "imageryLevel", L: L });
        levels[L] = g;
        levelOrder.push(L);
      }
      return levels[L];
    }
    function addTile(p) {
      withComp(rec.sourceComp, mapComp, function () {
        var ids = api.addAssetToComp(assetOf[imageryPath(p)]), id = Array.isArray(ids) ? ids[0] : ids;
        var res = null;
        try { res = api.get(id, "resolution"); } catch (e) { res = null; }
        // A palette PNG loads 0 x 0 and draws nothing: dropped.
        if (!res || !(res.x > 0) || !(res.y > 0)) { api.deleteLayer(id); unreadable++; return; }
        api.parent(id, levelGroup(p.L));
        var f = tileFrame(p, res);
        api.set(id, { "position.x": f.x, "position.y": f.y, "rotation.z": 0, "scale.x": f.sx, "scale.y": f.sy });
        tagPart(id, { category: "imageryTile", L: p.L, row: p.row, col: p.col, j: p.j });
        built++;
      });
    }

    // The drivers (the View's, the filter's and each level's opacity), the photo shown and stacked, the Spotlight
    // connected, and the previous photo hidden and queued for removal. Empty level groups (all their tiles unreadable) go.
    function drivers() {
      var W = size.width, H = size.height;
      Object.keys(levels).forEach(function (L) {
        if (!api.getChildren(levels[L]).length) { deleteIfThere(levels[L]); }
      });
      levelOrder = levelOrder.filter(function (L) { return api.getChildren(levels[L]).length > 0; });
      IMAGERY_VIEW_DRIVERS.forEach(function (d) {
        var drv = utilityLayer(rec.groupId, d[1], E.imageryViewExpression(ASTRO_REPROJECT_SRC, d[0], W, H, { category: "imageryDriver" }),
          E.IMAGERY_CAMERA_INPUTS, {}, { category: "imageryDriver" });
        feedCamera(s.cameraId, drv);
        api.connect(drv, A.DRIVER_OUTPUT_ATTR, d[0] === "viewScale" || d[0] === "viewOffset" ? filter : view, d[0], true);
      });
      levelOrder.forEach(function (L) {
        withComp(rec.sourceComp, mapComp, function () {
          var drv = utilityLayer(view, "Imagery driver: z " + L + " opacity", E.imageryLevelExpression(ASTRO_REPROJECT_SRC, L, W, { category: "imageryDriver" }),
            E.IMAGERY_CAMERA_INPUTS, {}, { category: "imageryDriver" });
          feedCamera(s.cameraId, drv);
          api.connect(drv, A.DRIVER_OUTPUT_ATTR, levels[L], "opacity", true);
        });
      });
      setHidden(rec.groupId, keep.hidden);
      // A first photo goes above the stars and below the lines, borders, names and reveals. A rebuild takes the old
      // photo's place (directly above it), so the user's own order of the layers is not undone.
      var replaced = previous.filter(function (im) { return layerThere(im.groupId); })[0];
      if (replaced) placeAbove(rec.groupId, replaced.groupId);
      else stackImagery(s, rec.groupId);
      refreshSpotlight(s);
      previous.forEach(function (im) {
        if (im.groupId === rec.groupId || !layerThere(im.groupId)) return;
        setHidden(im.groupId, true);
        pending = pending.concat(teardownEntries(im, mapComp));
      });
    }

    var job = {
      unit: function () {
        if (phase === "setup") { setup(); phase = "tiles"; }
        else if (phase === "tiles") {
          if (next < queue.length) addTile(queue[next++]);
          else { drivers(); phase = pending.length ? "cleanup" : "done"; }
        } else if (phase === "discard" || phase === "cleanup") {
          removeEntry(pending.shift(), mapComp);
          if (!pending.length) phase = phase === "discard" ? "cancelled" : "done";
        }
      },
      done: function () { return phase === "done" || phase === "cancelled"; },
      progress: function () { return { built: next, total: queue.length, phase: phase }; },
      result: function () {
        if (phase === "cancelled") return { ok: false, cancelled: true };
        // The Controls are re-made on the new utilities (the rows' links follow the layers, as the other scene actions do).
        syncControls(s);
        return { ok: true, groupId: rec.groupId, tiles: built, missing: missing, unreadable: unreadable, levels: levelOrder.length,
          message: doneMessage(built, missing) };
      },
      // A failed build takes its new photo down (the old one is untouched). A failure after the drivers keeps the new photo.
      fail: function () {
        if (phase === "setup" || phase === "tiles") {
          try { deleteIfThere(rec.groupId); } catch (e) { /* already failing */ }
          try { deleteIfThere(rec.sourceComp); } catch (e) { /* already failing */ }
        }
        phase = "failed";
      },
      cancel: function () {
        if (phase === "discard" || phase === "cancelled") return true;
        if (phase !== "setup" && phase !== "tiles") return false;
        if (!rec.groupId) { phase = "cancelled"; return true; }
        pending = teardownEntries({ groupId: rec.groupId, sourceComp: rec.sourceComp }, mapComp);
        phase = pending.length ? "discard" : "cancelled";
        return true;
      }
    };
    return runJob(job, budget, onProgress || function () {}, onDone || function () {});
  }

  // Takes the sky's photo apart: it is hidden, then its layers come down a layer per step (its assets stay).
  // onDone(result) runs once. Returns { cancel() }.
  function removeImagery(s, onDone) {
    var mapComp = api.getActiveComp(), pending = [];
    imageryGroups(s).forEach(function (g) {
      var im = imageryParts(g);
      setHidden(g, true);
      pending = pending.concat(teardownEntries(im, mapComp));
    });
    return runJob({
      unit: function () { removeEntry(pending.shift(), mapComp); },
      done: function () { return !pending.length; },
      progress: function () { return { built: 0, total: pending.length, phase: "remove" }; },
      result: function () { return { ok: true }; }
    }, IMAGERY_STEP_MS, null, onDone || function () {});
  }

  // The credit for the photo: one text layer "Imagery credit" in the sky's group, bottom-left (as Geo's), in the theme's names colour.
  // Pressing it again keeps the one layer and sets its text again.
  var IMAGERY_CREDIT_NAME = "Imagery credit", IMAGERY_CREDIT = "NASA/Goddard SVS · Gaia DR2: ESA/Gaia/DPAC";
  var CREDIT_FONT_SIZE = 24, CREDIT_IN = 200, CREDIT_UP = 80;
  function addImageryCredit(s) {
    var size = compSize(), id = null;
    api.getChildren(s.groupId).forEach(function (k) { if (!id && api.getNiceName(k) === IMAGERY_CREDIT_NAME) id = k; });
    if (!id) {
      id = api.create(A.TEXT_LAYER_TYPE, IMAGERY_CREDIT_NAME);
      api.parent(id, s.groupId);
      setOne(id, "fontSize", CREDIT_FONT_SIZE);
      api.set(id, { position: [-size.width / 2 + CREDIT_IN, -size.height / 2 + CREDIT_UP] });
    }
    setOne(id, A.TEXT_ATTR, IMAGERY_CREDIT);
    applyStyle(id, { fill: themeOf(s).names });
    return id;
  }

  return {
    IMAGERY_TYPE: IMAGERY_TYPE,
    IMAGERY_CREDIT: IMAGERY_CREDIT,
    REPROJECT_MISSING: REPROJECT_MISSING,
    PACK_MISSING: PACK_MISSING,
    reprojectAvailable: reprojectAvailable,
    imageryPackAvailable: imageryPackAvailable,
    planImagery: planImagery,
    beginImageryBuild: beginImageryBuild,
    findImagery: findImagery,
    removeImagery: removeImagery,
    addImageryCredit: addImageryCredit,
    createSky: createSky,
    findSkies: findSkies,
    skyData: skyData,
    skyTheme: themeOf,
    readSkyTheme: readSkyTheme,
    setSkyTheme: setSkyTheme,
    compFrameRange: compFrameRange,
    compFps: compFps,
    skyLayers: skyLayers,
    readCamera: readCamera,
    setCamera: setCamera,
    setWholeSky: setWholeSky,
    readStars: readStars,
    setDarkness: setDarkness,
    setStarSize: setStarSize,
    setStarColours: setStarColours,
    setGlow: setGlow,
    applyTheme: applyTheme,
    jumpCamera: jumpCamera,
    flyTarget: flyTarget,
    flyCamera: flyCamera,
    flyTo: flyTo,
    recordFlight: recordFlight,
    lastFlight: lastFlight,
    flightAt: flightAt,
    flightStart: flightStart,
    readCameraAt: readCameraAt,
    extendComp: extendComp,
    REVEAL_PARTS: REVEAL_PARTS,
    createReveal: createReveal,
    findReveals: findReveals,
    revealMembers: revealMembers,
    changeReveal: changeReveal,
    refreshSpotlight: refreshSpotlight,
    prepareReveals: prepareReveals
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroScene;
