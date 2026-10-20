// Builds the JavaScript expressions stored on CavalryAstro's sky layers.
// Inputs are read by their renamed name first, then by Cavalry's nN index name (the Cavalry Geo pattern).
var AstroExpression = (function () {
  var CAMERA_INPUTS = [["centreRa", 83.8], ["centreDec", 0], ["fov", 60], ["rotation", 0], ["projection", 0]];
  // The comp size is the last pair so that the frame width is read the same way by every sky layer kind.
  var SKY_INPUTS = [["camRa", 0], ["camDec", 0], ["camFov", 60], ["camRotation", 0], ["camProjection", 0], ["compW", 1920], ["compH", 1080]];
  var STAR_INPUTS = SKY_INPUTS.concat([["darkness", 100], ["size", 1]]);
  var LINE_INPUTS = SKY_INPUTS.concat([["draw", 1]]);
  var TEXT_INPUTS = SKY_INPUTS.concat([["textSize", 18], ["dx", 0], ["dy", 0]]);
  var KIND_INPUTS = { stars: STAR_INPUTS, lines: LINE_INPUTS, border: SKY_INPUTS, texts: TEXT_INPUTS };
  // The camera a sky layer draws through, read from its prelude variables (_i0.._i4).
  var CAM = "{ra: _i0, dec: _i1, fov: _i2, rotation: _i3, projection: _i4}";
  var DATA_OPEN = "/*ASTRO_DATA*/var ASTRO_DATA = ", DATA_CLOSE = ";/*ASTRO_DATA_END*/";

  function inputIndex(inputs, name) {
    for (var i = 0; i < inputs.length; i++) if (inputs[i][0] === name) return i;
    return -1;
  }

  function writeTag(tag, obj) {
    return "/*" + tag + " " + JSON.stringify(obj).replace(/\*\//g, "*\\/") + " " + tag + "*/";
  }

  function readTag(expr, tag) {
    var open = "/*" + tag + " ", close = " " + tag + "*/";
    var a = expr.indexOf(open);
    if (a < 0) return null;
    var b = expr.indexOf(close, a);
    if (b < 0) return null;
    try { return JSON.parse(expr.slice(a + open.length, b)); } catch (e) { return null; }
  }

  // One var per input: the renamed input if it exists, else its nN index, else the default.
  function inputPrelude(inputs) {
    return inputs.map(function (inp, i) {
      return "var _i" + i + " = (typeof " + inp[0] + " !== \"undefined\") ? " + inp[0] +
        " : ((typeof n" + i + " !== \"undefined\") ? n" + i + " : " + JSON.stringify(inp[1]) + ");";
    }).join("\n") + "\n";
  }

  function inputsFor(kind) {
    if (!Object.prototype.hasOwnProperty.call(KIND_INPUTS, kind)) throw new Error("Unknown sky layer kind: " + kind);
    return KIND_INPUTS[kind];
  }

  // The AstroRender call for a kind. Its last argument is the Cavalry Path the layer fills.
  function kindCall(kind, inputs, opts) {
    var o = opts || {};
    var v = function (name) { return "_i" + inputIndex(inputs, name); };
    var frame = v("compW"), frameH = "frameH: " + v("compH");
    var args;
    if (kind === "stars") args = "{darkness: " + v("darkness") + ", size: " + v("size") + ", ignoreLimit: " + (o.ignoreLimit ? "true" : "false") +
      ", sizeScale: " + (o.sizeScale || 1) + ", " + frameH + "}";
    else if (kind === "lines") args = "{draw: " + v("draw") + ", " + frameH + "}";
    else if (kind === "texts") args = "{size: " + v("textSize") + ", dx: " + v("dx") + ", dy: " + v("dy") + ", " + frameH + "}";
    else args = "{" + frameH + "}";
    return "AstroRender." + kind + "(ASTRO_DATA, " + CAM + ", " + frame + ", " + args + ", cavalry.Path);\n";
  }

  // A sky layer: the meta tag, the runtime, the input prelude, the embedded data, then one AstroRender call.
  // kind is "stars", "lines", "border" or "texts"; opts.ignoreLimit (stars) draws regardless of darkness.
  function layerExpression(runtimeSrc, kind, data, meta, opts) {
    var inputs = inputsFor(kind);
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(inputs) +
      DATA_OPEN + JSON.stringify(data) + DATA_CLOSE + "\n" + kindCall(kind, inputs, opts);
  }

  // The camera is a JavaScript Utility that does nothing per frame: its values are read by the sky layers.
  function cameraExpression() {
    return "0;";
  }

  // ---- Reveals and spotlight (Task 9). Utilities: each returns its value as the last expression. ----
  // Amount % (0..100) keyed by the reveal's amount utility; the rest are its settings.
  var REVEAL_INPUTS = [["amount", 0], ["spotlight", 60], ["titleMode", 0], ["corner", 1], ["margin", 60], ["offsetY", 80]];
  // One staged part reads only the amount.
  var STAGE_INPUTS = [["amount", 0]];
  // The title's place: the reveal's settings, the constellation centre, the camera and the comp size.
  var TITLE_INPUTS = [["titleMode", 0], ["corner", 1], ["margin", 60], ["offsetY", 80], ["conRa", 0], ["conDec", 0],
    ["camRa", 0], ["camDec", 0], ["camFov", 60], ["camRotation", 0], ["compW", 1920], ["compH", 1080], ["fontSize", 72]];
  // The glow's opacity: the spotlight's visible share (0..100) of the glow level (0..100).
  var GLOW_LEVEL_INPUTS = [["visible", 100], ["level", 60]];

  // The Spotlight's inputs for n reveals: each reveal's amount, then its spotlight.
  function spotlightInputs(n) {
    var out = [];
    for (var k = 0; k < n; k++) out.push(["amount" + k, 0], ["spotlight" + k, 60]);
    return out;
  }

  function revealAmountExpression(meta) {
    return writeTag("ASTRO_META", meta) + "\n" + inputPrelude(REVEAL_INPUTS) + "_i0;\n";
  }

  // One part's value from the amount: a percentage for the opacities, 0..1 for the lines' draw.
  function stageExpression(runtimeSrc, part, meta) {
    var scale = part === "lines" ? "" : " * 100";
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(STAGE_INPUTS) +
      "AstroReveal.stage(_i0, AstroReveal.STAGES." + part + ")" + scale + ";\n";
  }

  // The title's [x, y]: projects the constellation centre through the camera, then AstroReveal.titlePosition.
  // The projection is always stereographic here; the field of view is clamped so the projector never fails.
  function titlePositionExpression(runtimeSrc, meta, charCount) {
    var v = function (name) { return "_i" + inputIndex(TITLE_INPUTS, name); };
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(TITLE_INPUTS) +
      "var _p = [0, 0];\n" +
      "var _cam = {ra: " + v("camRa") + ", dec: " + v("camDec") + ", fov: Math.min(220, Math.max(0.5, " + v("camFov") + ")), rotation: " +
      v("camRotation") + ", projection: 0};\n" +
      "var _seen = AstroSky.makeProjector(_cam, " + v("compW") + ")(" + v("conRa") + ", " + v("conDec") + ", _p);\n" +
      "AstroReveal.titlePosition(" + v("titleMode") + ", " + v("corner") + ", " + v("margin") + ", " + v("compW") + ", " +
      v("compH") + ", _seen ? _p : null, " + v("offsetY") + ", " + v("fontSize") + ", " + (Number(charCount) || 0) + ");\n";
  }

  // The spotlight: 100 minus the darkest dim of the reveals (their amounts and spotlights, from the inputs).
  function spotlightExpression(runtimeSrc, n, meta) {
    var pairs = [];
    for (var k = 0; k < n; k++) {
      pairs.push("{amount: _i" + (2 * k) + ", spotlight: _i" + (2 * k + 1) + "}");
    }
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(spotlightInputs(n)) +
      "100 - AstroReveal.spotlightDim([" + pairs.join(", ") + "]);\n";
  }

  function glowLevelExpression(meta) {
    return writeTag("ASTRO_META", meta) + "\n" + inputPrelude(GLOW_LEVEL_INPUTS) + "_i0 * _i1 / 100;\n";
  }

  // ---- Imagery (Task 5). Utilities that read the Camera's five values, and the runtime (ASTRO_REPROJECT_SRC). ----
  var IMAGERY_CAMERA_INPUTS = [["camRa", 0], ["camDec", 0], ["camFov", 60], ["camRotation", 0], ["camProjection", 0]];
  // The photo's opacity (0..100) and the spotlight's visible share (0..100) of it.
  var IMAGERY_OPACITY_INPUTS = [["opacity", 100], ["spotVisible", 100]];
  // The camera read from the inputs, then normalised as the render does (AstroSky.safeCam: projection 0, fov clamped,
  // non-finite values guarded), so a bad camera gives finite values rather than throwing. Defines _c.
  var IMAGERY_CAM = "var _c = AstroSky.safeCam({ra: _i0, dec: _i1, fov: _i2, rotation: _i3, projection: _i4});\n";
  // The View's results from AstroReproject.viewFor. Position: whole source pixels, the same numbers the filter's offset is
  // derived from (so the photo and the filter's mapping agree); scale; and the filter's view scale and view offset
  // (uncentred, as the shader reads them).
  var IMAGERY_VIEW_RESULTS = {
    position: "[_v.position[0], _v.position[1]];",
    scale: "[_v.scale, _v.scale];",
    viewScale: "_v.scale;",
    viewOffset: "[_v.offset[0], _v.offset[1]];"
  };
  function imageryViewExpression(runtimeSrc, which, frameW, frameH, meta) {
    if (!Object.prototype.hasOwnProperty.call(IMAGERY_VIEW_RESULTS, which)) throw new Error("Unknown imagery view driver: " + which);
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(IMAGERY_CAMERA_INPUTS) +
      IMAGERY_CAM + "var _v = AstroReproject.viewFor(_c, " + Number(frameW) + ", " + Number(frameH) + ");\n" + IMAGERY_VIEW_RESULTS[which] + "\n";
  }
  // A level's opacity (0..100) at the camera (AstroImagery.levelOpacity).
  function imageryLevelExpression(runtimeSrc, L, frameW, meta) {
    return writeTag("ASTRO_META", meta) + "\n" + runtimeSrc + "\n;\n" + inputPrelude(IMAGERY_CAMERA_INPUTS) +
      IMAGERY_CAM + "AstroImagery.levelOpacity(" + Number(L) + ", _c, " + Number(frameW) + ");\n";
  }
  // The photo's opacity: its opacity input times the spotlight's visible share, over 100.
  function imageryOpacityExpression(meta) {
    return writeTag("ASTRO_META", meta) + "\n" + inputPrelude(IMAGERY_OPACITY_INPUTS) + "_i0 * _i1 / 100;\n";
  }

  return {
    IMAGERY_CAMERA_INPUTS: IMAGERY_CAMERA_INPUTS,
    IMAGERY_OPACITY_INPUTS: IMAGERY_OPACITY_INPUTS,
    imageryViewExpression: imageryViewExpression,
    imageryLevelExpression: imageryLevelExpression,
    imageryOpacityExpression: imageryOpacityExpression,
    REVEAL_INPUTS: REVEAL_INPUTS,
    STAGE_INPUTS: STAGE_INPUTS,
    TITLE_INPUTS: TITLE_INPUTS,
    GLOW_LEVEL_INPUTS: GLOW_LEVEL_INPUTS,
    spotlightInputs: spotlightInputs,
    revealAmountExpression: revealAmountExpression,
    stageExpression: stageExpression,
    titlePositionExpression: titlePositionExpression,
    spotlightExpression: spotlightExpression,
    glowLevelExpression: glowLevelExpression,
    CAMERA_INPUTS: CAMERA_INPUTS,
    SKY_INPUTS: SKY_INPUTS,
    STAR_INPUTS: STAR_INPUTS,
    LINE_INPUTS: LINE_INPUTS,
    TEXT_INPUTS: TEXT_INPUTS,
    inputIndex: inputIndex,
    writeTag: writeTag,
    readTag: readTag,
    layerExpression: layerExpression,
    cameraExpression: cameraExpression
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroExpression;
