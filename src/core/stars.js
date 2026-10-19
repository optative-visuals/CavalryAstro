// Star appearance: magnitude to size, darkness to limiting magnitude, B-V to colour band, and label text.
// Depends only on the catalogue's Greek table, and only for the "bayer-latin" label mode. Without it
// (in the in-layer runtime) that mode falls back to the Bayer form.
if (typeof AstroCatalog === "undefined" && typeof require !== "undefined") { var AstroCatalog = require("./catalog.js"); }

var AstroStars = (function () {
  // Radius at magnitude -1.5 is 10 px and at magnitude 6 is 1.0 px (a factor of 10 over 7.5 magnitudes).
  var R_BRIGHT = 10, MAG_BRIGHT = -1.5, MAG_SPAN = 7.5;
  // Stars fade to nothing across this many magnitudes before the limit, so they do not pop out.
  var FADE_SPAN = 0.5;

  // B-V upper bounds (inclusive) for the seven colour bands; the last band is open-ended.
  var BANDS = [-0.1, 0.15, 0.45, 0.7, 1.0, 1.4, Infinity];
  var BAND_COLOURS = ["#9bb0ff", "#c3d1ff", "#f2f4ff", "#fff4e0", "#ffe2b8", "#ffc58f", "#ffa66b"];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Limiting magnitude for a sky darkness slider value 0 (City) .. 100 (Countryside).
  function limitFor(darkness) {
    return 3 + 4 * clamp(darkness, 0, 100) / 100;
  }

  // Star radius in px, zero at and beyond the limiting magnitude.
  function radius(mag, limit, size) {
    if (size === undefined || size === null) size = 1;
    var base = R_BRIGHT * Math.pow(10, -(mag - MAG_BRIGHT) / MAG_SPAN);
    var fade = clamp((limit - mag) / FADE_SPAN, 0, 1);
    return Math.max(0, base * fade * size);
  }

  // Index 0..6 of the colour band that a B-V colour index falls in.
  function bandOf(bv) {
    for (var i = 0; i < BANDS.length - 1; i++) if (bv <= BANDS[i]) return i;
    return BANDS.length - 1;
  }

  // "δ" -> "del" using the catalogue's Greek table in reverse. A numeric suffix ("α1") is kept.
  // Returns the input unchanged when the table is unavailable or the letter is not in it.
  function latinOf(bayer) {
    if (typeof AstroCatalog === "undefined" || !AstroCatalog || !AstroCatalog.GREEK) return bayer;
    var m = /^(\D+)(\d*)$/.exec(bayer);
    if (!m) return bayer;
    var table = AstroCatalog.GREEK;
    for (var i = 0; i < table.length; i++) {
      if (table[i][1] === m[1]) return table[i][0].toLowerCase() + m[2];
    }
    return bayer;
  }

  // Label for a star: its proper name if it has one, otherwise its Bayer designation and constellation.
  // mode "bayer" gives "δ Ori"; mode "bayer-latin" gives "del Ori".
  function labelText(name, bayer, conId, mode) {
    if (name) return String(name);
    if (!bayer) return "";
    var b = mode === "bayer-latin" ? latinOf(String(bayer)) : String(bayer);
    return conId ? b + " " + conId : b;
  }

  return {
    limitFor: limitFor,
    radius: radius,
    BANDS: BANDS,
    BAND_COLOURS: BAND_COLOURS,
    bandOf: bandOf,
    labelText: labelText
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroStars;
