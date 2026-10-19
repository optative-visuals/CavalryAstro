// Imagery levels and tile planning: which local tiles of the plate carree Milky Way a camera needs.
// Tiles are 1024 x 1024 JPEGs. Row 0 is the strip at Dec +90; column 0 starts at RA 0 and RA rises with column.
// No dependencies, so this file can also run inside a Cavalry layer expression.
if (typeof AstroSky === "undefined" && typeof require !== "undefined") { var AstroSky = require("./sky.js"); }

var AstroImagery = (function () {
  var LEVELS = [
    { L: 0, w: 4096, h: 2048, cols: 4, rows: 2 },
    { L: 1, w: 8192, h: 4096, cols: 8, rows: 4 },
    { L: 2, w: 16384, h: 8192, cols: 16, rows: 8 },
    { L: 3, w: 32768, h: 16384, cols: 32, rows: 16 }
  ];
  var TILE = 1024;
  // A plan above MAX_TILES drops its finest level; above WARN_TILES the panel warns.
  var MAX_TILES = 300, WARN_TILES = 150;
  // Samples across the frame for visibleTiles: a 17 x 17 grid.
  var GRID = 17;
  // A level fades in over this many octaves (log2 px/deg) before the frame needs it.
  var FADE_OCTAVES = 0.3;
  var MAX_LEVEL = LEVELS.length - 1;

  function tilePath(base, L, row, col) {
    return base + "/imagery/nasa-dsm/L" + L + "/" + row + "_" + col + ".jpg";
  }

  function pxPerDegree(L) { return LEVELS[L].w / 360; }

  // The lowest level whose px/deg covers the frame's px/deg at the centre, capped at MAX_LEVEL.
  function levelFor(cam, frameW) {
    var ppd = AstroSky.pixelsPerDegree(cam, frameW);
    for (var L = 0; L < MAX_LEVEL; L++) {
      if (pxPerDegree(L) >= ppd) return L;
    }
    return MAX_LEVEL;
  }

  // Opacity 0..100 of level L. L0 is always 100. Any other level is needed once the frame's px/deg passes
  // level L-1's, and fades in over the FADE_OCTAVES before that point (in log2 px/deg, as Geo's levelOpacity does
  // in zoom). The level beneath stays at 100, so a fading level never shows through to nothing.
  function levelOpacity(L, cam, frameW) {
    if (L <= 0) return 100;
    if (L > MAX_LEVEL) return 0;
    var u = Math.log(AstroSky.pixelsPerDegree(cam, frameW)) / Math.LN2;
    var need = Math.log(pxPerDegree(L - 1)) / Math.LN2;
    if (u >= need) return 100;
    var start = need - FADE_OCTAVES;
    if (u <= start) return 0;
    return 100 * (u - start) / FADE_OCTAVES;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // The tile holding [ra, dec] at level L.
  function tileOf(L, ra, dec) {
    var g = LEVELS[L];
    var col = Math.floor(AstroSky.wrapRa(ra) / 360 * g.cols);
    var row = Math.floor((90 - dec) / 180 * g.rows);
    return { row: clamp(row, 0, g.rows - 1), col: clamp(col, 0, g.cols - 1) };
  }

  // The RA/Dec box (degrees) covered by a tile.
  function tileBox(L, row, col) {
    var g = LEVELS[L];
    return {
      ra0: col * 360 / g.cols,
      ra1: (col + 1) * 360 / g.cols,
      dec0: 90 - (row + 1) * 180 / g.rows,
      dec1: 90 - row * 180 / g.rows
    };
  }

  // The Cavalry pixels of the 17 x 17 grid over a frame (centre at 0,0, y up), edges included.
  function frameGrid(frameW, frameH) {
    var pts = [];
    for (var i = 0; i < GRID; i++) {
      for (var j = 0; j < GRID; j++) {
        pts.push([-frameW / 2 + i * frameW / (GRID - 1), -frameH / 2 + j * frameH / (GRID - 1)]);
      }
    }
    return pts;
  }

  // The tiles a frame shows at level L: the tiles under the frame grid, plus their neighbours
  // (so a tile at a grid gap is still loaded, and the RA seam at 0/360 wraps to the far column).
  function visibleTiles(L, cam, frameW, frameH) {
    var g = LEVELS[L], seen = {}, out = [];
    function add(row, col) {
      if (row < 0 || row >= g.rows) return;
      var c = ((col % g.cols) + g.cols) % g.cols;
      var key = row + "_" + c;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ row: row, col: c });
    }
    var hits = {};
    frameGrid(frameW, frameH).forEach(function (p) {
      var radec = AstroSky.unproject(cam, frameW, p[0], p[1]);
      var t = tileOf(L, radec[0], radec[1]);
      hits[t.row + "_" + t.col] = t;
    });
    Object.keys(hits).forEach(function (k) {
      var t = hits[k];
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) add(t.row + dr, t.col + dc);
    });
    return out;
  }

  // The tiles a set of camera samples needs: each sample's level and the level below it, plus every L0 tile.
  // If the total exceeds MAX_TILES, the top level is dropped (and again, if still over), and capped reports the
  // highest level dropped, or null when nothing was dropped.
  function planTiles(samples, frameW, frameH) {
    var keep = {}, capped = null;
    function put(t) { keep[key(t)] = t; }
    // Every L0 tile is always planned.
    for (var r = 0; r < LEVELS[0].rows; r++) for (var c = 0; c < LEVELS[0].cols; c++) put({ L: 0, row: r, col: c });
    samples.forEach(function (cam) {
      var top = levelFor(cam, frameW);
      for (var L = Math.max(1, top - 1); L <= top; L++) {
        visibleTiles(L, cam, frameW, frameH).forEach(function (t) { put({ L: L, row: t.row, col: t.col }); });
      }
    });

    while (Object.keys(keep).length > MAX_TILES && maxLevel(keep) > 0) {
      var top = maxLevel(keep);
      if (capped === null) capped = top;
      Object.keys(keep).forEach(function (k) { if (keep[k].L === top) delete keep[k]; });
    }

    var items = Object.keys(keep).map(function (k) { return keep[k]; });
    items.sort(function (a, b) { return (a.L - b.L) || (a.row - b.row) || (a.col - b.col); });
    return { items: items, capped: capped, count: items.length };
  }

  function key(t) { return t.L + "_" + t.row + "_" + t.col; }
  function maxLevel(keep) {
    var m = 0;
    Object.keys(keep).forEach(function (k) { if (keep[k].L > m) m = keep[k].L; });
    return m;
  }

  return {
    LEVELS: LEVELS,
    TILE: TILE,
    MAX_TILES: MAX_TILES,
    WARN_TILES: WARN_TILES,
    tilePath: tilePath,
    pxPerDegree: pxPerDegree,
    levelFor: levelFor,
    levelOpacity: levelOpacity,
    tileOf: tileOf,
    tileBox: tileBox,
    frameGrid: frameGrid,
    visibleTiles: visibleTiles,
    planTiles: planTiles
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroImagery;
