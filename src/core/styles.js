// Sky themes: named sets of colours, line widths and star settings for the sky, its lines, borders,
// names and reveal. Pure: the scene draws with them and the panel lists, saves and deletes them.
// A theme never touches the camera, the sky data or the reveal's timing.
if (typeof AstroStars === "undefined" && typeof require !== "undefined") { var AstroStars = require("./stars.js"); }

var AstroStyles = (function () {
  var ROLES = ["background", "lines", "borders", "names", "revealLines", "revealBorder", "revealLabels", "title"];
  var WIDTH_ROLES = ["linesWidth", "bordersWidth", "revealLinesWidth", "revealBorderWidth"];
  var STAR_MODES = ["true", "mono"], NAME_CASES = ["upper", "title"];
  var HEX = /^#[0-9a-fA-F]{6}$/;
  // The preview's frame colour is fixed, so a theme's own colours never make it hard to see.
  var FRAME = "#2fbf71";

  // Colours in ROLES order, widths in WIDTH_ROLES order, then the star and text settings.
  function make(name, colours, widths, star) {
    var t = { name: name };
    ROLES.forEach(function (r, i) { t[r] = colours[i]; });
    WIDTH_ROLES.forEach(function (r, i) { t[r] = widths[i]; });
    t.starMode = star.mode; t.starColour = star.colour; t.glow = star.glow;
    t.titleFont = star.font; t.nameCase = star.nameCase;
    return t;
  }
  var BUILT_IN = [
    make("Realistic", ["#05070d", "#6f8fc8", "#3f5a88", "#d6deef", "#ffd166", "#ffd166", "#ffd166", "#ffffff"], [1.2, 0.6, 1.8, 1.2],
      { mode: "true", colour: "#ffffff", glow: 0.6, font: "Helvetica", nameCase: "title" }),
    make("Mono", ["#0a0a0a", "#4a4a4a", "#2e2e2e", "#e6e6e6", "#ffffff", "#ffffff", "#ffffff", "#ffffff"], [0.6, 0.5, 1.5, 1.2],
      { mode: "mono", colour: "#f2f2f2", glow: 0.2, font: "Helvetica", nameCase: "upper" }),
    make("Blueprint", ["#12365f", "#cfe3ff", "#7fa6d9", "#ffffff", "#ffd166", "#ffd166", "#ffd166", "#ffffff"], [0.6, 0.4, 1.2, 1.4],
      { mode: "mono", colour: "#ffffff", glow: 0.1, font: "Courier New", nameCase: "upper" }),
    make("Vintage chart", ["#f1e6cf", "#6b4f33", "#9b7b57", "#3b2a1a", "#a63d2f", "#a63d2f", "#a63d2f", "#3b2a1a"], [1.2, 0.8, 2, 1.6],
      { mode: "mono", colour: "#3b2a1a", glow: 0, font: "Georgia", nameCase: "title" }),
    make("Neon", ["#070714", "#ff3f8e", "#2de2e6", "#f2f2ff", "#ffd23f", "#ffd23f", "#ffd23f", "#ff3f8e"], [0.8, 0.8, 2, 1.6],
      { mode: "mono", colour: "#fff3ff", glow: 0.9, font: "Arial Black", nameCase: "upper" })
  ];

  // Every key a theme has, in the order they are saved.
  var KEYS = ROLES.concat(WIDTH_ROLES, ["starMode", "starColour", "glow", "titleFont", "nameCase"]);

  function key(name) { return String(name).trim().toLowerCase(); }
  function builtIn(name) {
    for (var i = 0; i < BUILT_IN.length; i++) if (key(BUILT_IN[i].name) === key(name)) return BUILT_IN[i];
    return null;
  }
  function isBuiltIn(name) { return builtIn(name) !== null; }

  // A full theme from a possibly partial object: anything missing or invalid comes from Realistic.
  // Returns null for anything that is not an object.
  function normalise(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    var base = BUILT_IN[0], out = {};
    out.name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Custom";
    ROLES.forEach(function (r) { out[r] = typeof obj[r] === "string" && HEX.test(obj[r]) ? obj[r] : base[r]; });
    WIDTH_ROLES.forEach(function (r) {
      var n = obj[r];
      out[r] = typeof n === "number" && isFinite(n) && n >= 0 ? n : base[r];
    });
    out.starMode = STAR_MODES.indexOf(obj.starMode) >= 0 ? obj.starMode : base.starMode;
    out.starColour = typeof obj.starColour === "string" && HEX.test(obj.starColour) ? obj.starColour : base.starColour;
    out.glow = typeof obj.glow === "number" && isFinite(obj.glow) ? Math.max(0, Math.min(1, obj.glow)) : base.glow;
    out.titleFont = typeof obj.titleFont === "string" && obj.titleFont.trim() ? obj.titleFont.trim() : base.titleFont;
    out.nameCase = NAME_CASES.indexOf(obj.nameCase) >= 0 ? obj.nameCase : base.nameCase;
    return out;
  }

  // The theme with this name: a built-in, then a saved one. Unknown names give Realistic.
  function find(name, saved) {
    var all = BUILT_IN.concat(saved || []);
    for (var i = 0; i < all.length; i++) if (key(all[i].name) === key(name)) return all[i];
    return BUILT_IN[0];
  }
  function names(saved) { return BUILT_IN.concat(saved || []).map(function (t) { return t.name; }); }

  // Seven colours for the star colour bands: the true colours, or one colour seven times (Mono and friends).
  function starColours(theme) {
    if (theme.starMode === "true") return AstroStars.BAND_COLOURS.slice();
    var out = [];
    for (var i = 0; i < AstroStars.BAND_COLOURS.length; i++) out.push(theme.starColour);
    return out;
  }

  // The few colours the panel's preview draws with.
  function previewColors(theme) {
    return {
      background: theme.background,
      star: theme.starMode === "true" ? AstroStars.BAND_COLOURS[2] : theme.starColour,
      lines: theme.lines,
      borders: theme.borders,
      names: theme.names,
      frame: FRAME
    };
  }

  // A colour as "#rrggbb", from a hex string (any alpha is dropped) or a Cavalry colour object {r, g, b, a} (as
  // api.get returns a material or stroke colour). Null for anything else.
  function toHex(v) {
    if (v && typeof v === "object" && v.r !== undefined) {
      return "#" + [v.r, v.g, v.b].map(function (n) {
        var s = Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16);
        return s.length < 2 ? "0" + s : s;
      }).join("");
    }
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) return v.slice(0, 7);
    return null;
  }

  return {
    ROLES: ROLES, WIDTH_ROLES: WIDTH_ROLES, KEYS: KEYS, BUILT_IN: BUILT_IN, toHex: toHex,
    normalise: normalise, builtIn: builtIn, isBuiltIn: isBuiltIn, find: find, names: names,
    starColours: starColours, previewColors: previewColors
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroStyles;
