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

  // A JavaScript Utility in groupId: its expression, its inputs (name, default) and their values.
  function utilityLayer(groupId, name, expr, inputs, values) {
    var id = api.create(A.CAMERA_LAYER_TYPE, name);
    setOne(id, A.CAMERA_EXPR_ATTR, expr);
    addInputs(id, A.CAMERA_ARRAY_ATTR, inputs, values || {});
    api.parent(id, groupId);
    return id;
  }

  // The glow's opacity: a utility that scales the glow level (theme glow, or 0 when off) by the spotlight's share.
  // The glow is driven, so applyTheme and setGlow write the level, not the glow's opacity.
  function glowLevelLayer(groupId, glowId, level) {
    var id = utilityLayer(groupId, NAMES.glowLevel, E.glowLevelExpression({ category: "glowLevel" }), E.GLOW_LEVEL_INPUTS,
      { visible: 100, level: level });
    api.connect(id, A.DRIVER_OUTPUT_ATTR, glowId, "opacity", true);
    return id;
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
    saveSky({ groupId: groupId }, theme, true);
    var cameraId = cameraLayer(groupId, c);
    backgroundLayer(groupId, theme);
    var borders = skyShape(groupId, cameraId, NAMES.borders, "border", bordersData(data.cons), { category: "borders" }, c);
    applyStyle(borders, { stroke: theme.borders, width: theme.bordersWidth });
    setOne(borders, "hidden", true);
    var lines = skyShape(groupId, cameraId, NAMES.lines, "lines", linesData(data.cons), { category: "lines" }, c);
    applyStyle(lines, { stroke: theme.lines, width: theme.linesWidth });
    var glow = skyShape(groupId, cameraId, NAMES.glow, "stars", glowStars(data.stars), { category: "glow" }, c, { size: GLOW_SIZE });
    applyStyle(glow, { fill: AstroStyles.previewColors(theme).star });
    glowBlur(groupId, glow);
    glowLevelLayer(groupId, glow, theme.glow * 100);
    var colours = AstroStyles.starColours(theme), bands = starsByBand(data.stars);
    for (var b = 0; b < bands.length; b++) {
      if (!bands[b].ra.length) continue;
      var band = skyShape(groupId, cameraId, "Stars · band " + b, "stars", bands[b], { category: "stars", band: b }, c);
      applyStyle(band, { fill: colours[b] });
    }
    var names = skyShape(groupId, cameraId, NAMES.names, "texts", namesData(data.cons, theme.nameCase), { category: "names" }, c);
    applyStyle(names, { fill: theme.names });
    setOne(names, "hidden", true);
    var made = { groupId: groupId, cameraId: cameraId, name: name }, ctl = syncControls(made);
    // The sky's Controls are what the user works in, so they are selected rather than the group.
    if (typeof api.select === "function") api.select(ctl && ctl.componentId ? ctl.componentId : groupId);
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
    saveSky(s, themeOf(s), !!on);
    if (L.glowLevel) setOne(L.glowLevel, A.CAMERA_ARRAY_ATTR + ".1", on ? themeOf(s).glow * 100 : 0);
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
    var glow = glowOn(s);
    write(L.glowLevel, A.CAMERA_ARRAY_ATTR + ".1", glow ? t.glow * 100 : 0);
    saveSky(s, t, glow);
    return tally;
  }

  // ---- Camera moves ---------------------------------------------------------------------------------
  // A flight keys the Camera's centreRa, centreDec and fov for each frame of its range. Its record (the
  // astroFlights user data on the Camera) lets a later Update flight rebuild the same keys. Ported from Cavalry Geo.
  var FLIGHTS_KEY = "astroFlights", EXTEND_PAD_SECONDS = 3, DEFAULT_FPS = 25;
  var FRAME_PAD = 1.4, FRAMING_FOV = [8, 120], STAR_FOV = 20;
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

  // The fov that holds a constellation's border: twice its farthest border point from its centre, times 1.4.
  // Some centres lie outside their own border, so the distance is taken from the centre to every ring point.
  function constellationFov(c) {
    var far = 0;
    (c.border || []).forEach(function (ring) {
      ring.forEach(function (p) { far = Math.max(far, AstroSky.angularDistance(c.centre[0], c.centre[1], p[0], p[1])); });
    });
    return clamp(far * 2 * FRAME_PAD, FRAMING_FOV[0], FRAMING_FOV[1]);
  }

  // A fly target: a constellation (index into the catalogue) or a star (index into the star list).
  // Returns { kind, index, label, ra, dec, fov }.
  function flyTarget(kind, index) {
    var data = skyData();
    if (kind === "constellation") {
      var c = data.cons[index];
      if (!c) throw new Error("No constellation at index " + index);
      return { kind: kind, index: index, label: c.name, ra: c.centre[0], dec: c.centre[1], fov: constellationFov(c) };
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
  // Keys already in the range are replaced. Returns { start, end }.
  function flyCamera(s, points, startFrame) {
    var end = startFrame + points.length - 1, prevRa = readCamera(s).ra;
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
        E.STAGE_INPUTS, {});
      api.connect(amountId, A.CAMERA_ARRAY_ATTR + ".0", id, A.CAMERA_ARRAY_ATTR + ".0", true);
      return id;
    }
    if (parts.indexOf("lines") >= 0) {
      var drawId = stage("lines");
      var lines = skyShape(groupId, s.cameraId, "Reveal lines", "lines", { lines: c.lines || [] }, { category: "revealLines" }, cam);
      applyStyle(lines, { stroke: theme.revealLines, width: theme.revealLinesWidth });
      feedInput(drawId, A.DRIVER_OUTPUT_ATTR, lines, A.SHAPE_ARRAY_ATTR, E.LINE_INPUTS, "draw");
    }
    if (parts.indexOf("border") >= 0) {
      var borderId = stage("border");
      ["Reveal border", "Reveal border glow"].forEach(function (name, k) {
        var ring = skyShape(groupId, s.cameraId, name, "border", { rings: c.border || [] }, { category: k ? "revealBorderGlow" : "revealBorder" }, cam);
        applyStyle(ring, { stroke: theme.revealBorder, width: theme.revealBorderWidth });
        api.connect(borderId, A.DRIVER_OUTPUT_ATTR, ring, "opacity", true);
        if (k) blurLayer(groupId, ring, name + " blur", REVEAL_GLOW_BLUR);
      });
    }
    // One layer per colour band the constellation's stars fall in. They ignore the darkness limit, so lines always join stars.
    var bands = [];
    for (var b = 0; b < AstroStars.BANDS.length; b++) bands.push({ ra: [], dec: [], mag: [] });
    (c.stars || []).forEach(function (row) {
      var g = bands[AstroStars.bandOf(data.stars.bv[row])];
      g.ra.push(data.stars.ra[row]); g.dec.push(data.stars.dec[row]); g.mag.push(data.stars.mag[row]);
    });
    bands.forEach(function (g, band) {
      if (!g.ra.length) return;
      var layer = skyShape(groupId, s.cameraId, "Reveal stars · band " + band, "stars", g, { category: "revealStars", band: band },
        cam, null, { ignoreLimit: true });
      applyStyle(layer, { fill: colours[band] });
    });
    if (parts.indexOf("labels") >= 0) {
      var labelId = stage("labels");
      var items = [];
      (c.stars || []).forEach(function (row) {
        var text = AstroStars.labelText(data.stars.name[row], data.stars.bayer[row], c.id, "bayer");
        if (text) items.push([text, data.stars.ra[row], data.stars.dec[row]]);
      });
      var labels = skyShape(groupId, s.cameraId, "Reveal labels", "texts", { items: items }, { category: "revealLabels" }, cam);
      applyStyle(labels, { fill: theme.revealLabels });
      api.connect(labelId, A.DRIVER_OUTPUT_ATTR, labels, "opacity", true);
    }
    if (parts.indexOf("title") >= 0) {
      var titleId = stage("title");
      var pos = utilityLayer(groupId, "Reveal title position", E.titlePositionExpression(ASTRO_REVEAL_SRC, { category: "revealTitle" }),
        E.TITLE_INPUTS, { conRa: c.centre[0], conDec: c.centre[1], compW: cw.width, compH: cw.height });
      ["titleMode", "corner", "margin", "offsetY"].forEach(function (n) {
        api.connect(amountId, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.REVEAL_INPUTS, n),
          pos, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.TITLE_INPUTS, n), true);
      });
      [["camRa", 0], ["camDec", 1], ["camFov", 2], ["camRotation", 3]].forEach(function (p) {
        api.connect(s.cameraId, A.CAMERA_ARRAY_ATTR + "." + p[1], pos, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.TITLE_INPUTS, p[0]), true);
      });
      var title = api.create(A.TEXT_LAYER_TYPE, "Title");
      setOne(title, A.TEXT_ATTR, caseName(c.name, theme.nameCase));
      applyStyle(title, { fill: theme.title });
      api.connect(pos, A.DRIVER_OUTPUT_ATTR, title, "position", true);
      api.connect(titleId, A.DRIVER_OUTPUT_ATTR, title, "opacity", true);
      api.parent(title, groupId);
    }
  }

  // Sets the reveal's amount settings the panel changed (spotlight, titleMode, corner, margin, offsetY).
  function setAmountSettings(amountId, o) {
    ["spotlight", "titleMode", "corner", "margin", "offsetY"].forEach(function (n) {
      if (o[n] === undefined) return;
      setOne(amountId, A.CAMERA_ARRAY_ATTR + "." + E.inputIndex(E.REVEAL_INPUTS, n), Number(o[n]));
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
    var groupId = api.create("group", "Reveal " + number + ": " + c.name);
    setRecord(groupId, { v: REVEAL_VERSION, con: c.id, name: c.name, parts: chosen, number: number });
    api.parent(groupId, s.groupId);
    var amountId = utilityLayer(groupId, "Reveal amount", E.revealAmountExpression({ category: "revealAmount" }), E.REVEAL_INPUTS, {
      spotlight: pickNumber(o.spotlight, DEFAULT_SPOTLIGHT), titleMode: pickNumber(o.titleMode, 0),
      corner: pickNumber(o.corner, DEFAULT_CORNER), margin: pickNumber(o.margin, DEFAULT_MARGIN), offsetY: pickNumber(o.offsetY, DEFAULT_OFFSET_Y)
    });
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
      E.spotlightInputs(reveals.length), {});
    reveals.forEach(function (r, k) {
      api.connect(r.amountId, A.CAMERA_ARRAY_ATTR + ".0", spot, A.CAMERA_ARRAY_ATTR + "." + (2 * k), true);
      api.connect(r.amountId, A.CAMERA_ARRAY_ATTR + ".1", spot, A.CAMERA_ARRAY_ATTR + "." + (2 * k + 1), true);
    });
    L.bands.concat([L.lines, L.borders, L.names]).forEach(function (id) {
      if (id) api.connect(spot, A.DRIVER_OUTPUT_ATTR, id, "opacity", true);
    });
    if (L.glowLevel) api.connect(spot, A.DRIVER_OUTPUT_ATTR, L.glowLevel, A.CAMERA_ARRAY_ATTR + ".0", true);
    return spot;
  }

  // Gives the reveals a number each (oldest first): a duplicate number takes the highest + 1, and the group is renamed.
  function renumber(reveals) {
    var top = 0, seen = {};
    reveals.forEach(function (r) { top = Math.max(top, r.number); });
    reveals.forEach(function (r) {
      if (r.number && !seen[r.number]) { seen[r.number] = true; return; }
      top += 1; seen[top] = true;
      var rec = revealRecord(r.groupId);
      if (!rec) return;
      rec.number = top;
      setRecord(r.groupId, rec);
      if (typeof api.rename === "function") { try { api.rename(r.groupId, "Reveal " + top + ": " + rec.name); } catch (e) { /* cosmetic */ } }
    });
  }

  // Drops the reveals whose group is gone, renumbers the rest, and rebuilds the Spotlight. Returns how many were dropped.
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
    api.setUserData(s.groupId, REVEALS_KEY, kept);
    renumber(findReveals(s));
    refreshSpotlight(s);
    syncControls(s);
    return removed;
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
