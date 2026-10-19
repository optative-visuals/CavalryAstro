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
    var frame = v("compW");
    var args;
    if (kind === "stars") args = "{darkness: " + v("darkness") + ", size: " + v("size") + ", ignoreLimit: " + (o.ignoreLimit ? "true" : "false") + "}";
    else if (kind === "lines") args = "{draw: " + v("draw") + "}";
    else if (kind === "texts") args = "{size: " + v("textSize") + ", dx: " + v("dx") + ", dy: " + v("dy") + "}";
    else args = "{}";
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

  return {
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
