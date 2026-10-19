// Cavalry attribute ids and value formats. Trimmed from Cavalry Geo's attrs.js (credit: Cavalry Geo by
// optative-visuals; its docs/cavalry-api-notes.md holds the probes behind these). Fill and stroke are switched
// with api.setFill / api.setStroke, not attributes.
var AstroAttrs = {
  // Shape: a javaScriptShape layer draws from its generator array.
  SHAPE_LAYER_TYPE: "javaScriptShape",
  SHAPE_EXPR_ATTR: "generator.expression",
  SHAPE_ARRAY_ATTR: "generator.array",
  ELLIPSE_SCALE: 1,                           // addEllipse(x, y, 5, 5) is 10 wide
  STROKE_WIDTH_ATTR: "stroke.width",          // after api.setStroke
  STROKE_CAP_ATTR: "stroke.capStyle",         // null if caps can't be set
  ROUND_CAP_VALUE: 1,                         // the value that gives round caps
  TRIM_REVERSED: false,                       // true if Trim runs from the path's last point

  // Utility: a JavaScript layer runs a script from its expression or array.
  CAMERA_LAYER_TYPE: "javaScript",
  CAMERA_EXPR_ATTR: "expression",
  CAMERA_ARRAY_ATTR: "array",
  CAMERA_BODY: "0;",                          // a JavaScript Utility that does nothing

  // Colour: material and stroke colours take {r,g,b,a} or hex; fill opacity runs 0-100.
  FILL_COLOR_ATTR: "material.materialColor",
  COLOR_VALUE: function (hex) { return hex; },
  STROKE_COLOR_ATTR: "stroke.strokeColor",
  COLOR_INPUT_TYPE: "color",
  FILL_ALPHA_ATTR: "opacity",                 // null if no fill opacity attribute is found
  COMP_BACKGROUND_ATTR: "backgroundColor",    // {r,g,b,a} or "#00000000"; alpha 0 is see-through in a reference

  // Text: a textShape layer, with its label driven from an array.
  TEXT_LAYER_TYPE: "textShape",
  TEXT_ATTR: "text",
  LABEL_MODE: "driver",
  DRIVER_OUTPUT_ATTR: "id",
  DRIVER_RETURN: "array",

  // Resolution: {x, y} on the composition.
  COMP_RESOLUTION_ATTR: "resolution",
  readResolution: function (v) { return Array.isArray(v) ? { width: v[0], height: v[1] } : { width: v.x, height: v.y }; },

  // Frame range: setting endFrame lengthens the comp and frameRange follows; playbackEnd does not follow.
  COMP_END_ATTR: "endFrame",
  COMP_PLAYBACK_END_ATTR: "playbackEnd",
  COMP_START_ATTR: "startFrame",
  COMP_FPS_ATTR: "fps",
  COMP_FRAME_RANGE_ATTR: "frameRange",        // {x: start, y: end}

  // ui.scriptLocation is undefined in Cavalry scripts, so data lives at a fixed path.
  ASSETS_DIR: function () { return String(api.getAppDataFolder()).replace(/\\/g, "/") + "/Scripts/CavalryAstro_assets"; }
};
if (typeof module !== "undefined" && module.exports) module.exports = AstroAttrs;
