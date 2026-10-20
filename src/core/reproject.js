// Reprojection maths: the RA/Dec box a frame shows, and where each frame pixel lands in the square source comp.
// Plate carree in the source: RA runs left to right (sx), Dec runs up (sy), both at one scale.
// This is the JavaScript mirror of the reprojection shader: change both together.
// No dependencies beyond sky.js and imagery.js, so it can run inside a Cavalry layer expression.
if (typeof AstroSky === "undefined" && typeof require !== "undefined") { var AstroSky = require("./sky.js"); }
if (typeof AstroImagery === "undefined" && typeof require !== "undefined") { var AstroImagery = require("./imagery.js"); }

var AstroReproject = (function () {
  var DEG = Math.PI / 180;
  // The square source comp the frame is fitted into (as in Geo).
  var SOURCE_PX = 4104;
  // Share of the comp left free on each side of the fitted box.
  var MARGIN = 0.02;
  // The projector's 120 degree circle, in planar radius (2·tan(c/2)).
  var CLAMP_R = 2 * Math.tan(60 * DEG);

  // The RA of ra relative to ref, in [-180, 180): RA is unwrapped around the camera.
  function relRa(ra, ref) { return AstroSky.nearestRa(ra, ref) - ref; }

  // Whether a pole (dec ±90) lies inside the frame.
  function poleInFrame(cam, frameW, frameH, dec) {
    var out = [0, 0];
    var inside = AstroSky.makeProjector(cam, frameW)(0, dec, out);
    return inside && Math.abs(out[0]) <= frameW / 2 && Math.abs(out[1]) <= frameH / 2;
  }

  // The RA/Dec box a frame shows, and the scale and offset that fit it into the source comp.
  // RA is unwrapped around cam.ra: ra0 and ra1 are cam.ra -/+ the half-width. A frame that holds a pole shows
  // every RA, so its half-width is 180.
  function viewFor(cam, frameW, frameH) {
    var halfRa = 0, dec0 = Infinity, dec1 = -Infinity;
    var pxPerRad = AstroSky.pixelsPerDegree(cam, frameW) / DEG;
    AstroImagery.frameGrid(frameW, frameH).forEach(function (p) {
      // Points beyond the projector's 120 degrees are not shown, so they do not set the box.
      if (Math.sqrt(p[0] * p[0] + p[1] * p[1]) / pxPerRad > CLAMP_R) return;
      var radec = AstroSky.unproject(cam, frameW, p[0], p[1]);
      halfRa = Math.max(halfRa, Math.abs(relRa(radec[0], cam.ra)));
      dec0 = Math.min(dec0, radec[1]);
      dec1 = Math.max(dec1, radec[1]);
    });
    if (poleInFrame(cam, frameW, frameH, 90)) { halfRa = 180; dec1 = 90; }
    if (poleInFrame(cam, frameW, frameH, -90)) { halfRa = 180; dec0 = -90; }
    var span = Math.max(2 * halfRa, dec1 - dec0, 1e-9);
    var rawScale = SOURCE_PX * (1 - 2 * MARGIN) / span;
    // Quantised DOWN to 1/8-octave steps, so a slowly moving camera keeps one scale for many frames (no re-sampling
    // shimmer). Flooring only shrinks the box, but the offset is rounded to whole source pixels, so recheck the
    // containment and step one more 1/8 octave down if the rounding pushes an edge out.
    var scale = Math.pow(2, Math.floor(8 * Math.log(rawScale) / Math.LN2) / 8);
    var decMid = (dec0 + dec1) / 2;
    var position, offset;
    for (;;) {
      // The View group's position: whole source pixels. The filter's offset is derived from it, so the photo and
      // the filter's mapping use the same numbers (the View's X carries the camera's RA, as the driver does).
      var offset0Raw = SOURCE_PX / 2;
      var offset1Raw = SOURCE_PX / 2 - decMid * scale;
      position = [
        Math.round(offset0Raw - SOURCE_PX / 2 - scale * cam.ra),
        Math.round(offset1Raw - SOURCE_PX / 2)
      ];
      offset = [position[0] + SOURCE_PX / 2 + scale * cam.ra, position[1] + SOURCE_PX / 2];
      // The box must stay inside the comp; the margin absorbs the half-pixel rounding.
      var fits = offset[0] - halfRa * scale >= 0 && offset[0] + halfRa * scale <= SOURCE_PX &&
        offset[1] + dec0 * scale >= 0 && offset[1] + dec1 * scale <= SOURCE_PX;
      if (fits) break;
      scale = Math.pow(2, Math.log(scale) / Math.LN2 - 1 / 8);
    }
    return {
      ra0: cam.ra - halfRa,
      ra1: cam.ra + halfRa,
      dec0: dec0,
      dec1: dec1,
      scale: scale,
      rawScale: rawScale,
      position: position,
      offset: offset
    };
  }

  // The source comp point of an output pixel (x, y), centre at 0,0, y up. Null beyond the projector's 120 degrees.
  function sourcePoint(cam, frameW, view, x, y) {
    var pxPerRad = AstroSky.pixelsPerDegree(cam, frameW) / DEG;
    if (Math.sqrt(x * x + y * y) / pxPerRad > CLAMP_R * (1 + 1e-12)) return null;
    var radec = AstroSky.unproject(cam, frameW, x, y);
    var d = relRa(radec[0], cam.ra);
    return [d * view.scale + view.offset[0], radec[1] * view.scale + view.offset[1]];
  }

  // Whether a source point is usable as a tap: inside the comp, and its sky point within the projector's 120 degrees
  // (cos c >= -0.5). Mirrors withinProjector and inComp in the shader. A non-positive view scale is invalid.
  function tapValid(cam, view, s) {
    if (!(view.scale > 0)) return false;
    if (s[0] < 0 || s[0] > SOURCE_PX || s[1] < 0 || s[1] > SOURCE_PX) return false;
    var d = (s[0] - view.offset[0]) / view.scale * DEG;
    var dec = (s[1] - view.offset[1]) / view.scale * DEG;
    var cosC = Math.sin(dec) * Math.sin(cam.dec * DEG) + Math.cos(dec) * Math.cos(cam.dec * DEG) * Math.cos(d);
    return cosC >= -0.5 - 1e-5;
  }

  // The source points the shader averages for output pixel (x, y): a 4×4 grid over the pixel's footprint, whose
  // edges are the source points of the pixel's right and upper neighbours. Mirrors the shader's tap layout (i outer,
  // j inner). Taps the shader drops (outside the comp, or beyond 120 degrees) are dropped here too, so fewer than 16
  // points come back near the edges. Returns the single source point when a neighbour lies beyond the projector's
  // 120 degrees (the shader falls back to one tap there), and null when the pixel itself lies beyond them.
  function footprintTaps(cam, frameW, view, x, y) {
    var s0 = sourcePoint(cam, frameW, view, x, y);
    if (!s0) return null;
    var sx = sourcePoint(cam, frameW, view, x + 1, y);
    var sy = sourcePoint(cam, frameW, view, x, y + 1);
    if (!sx || !sy) return [s0];
    var dx = [sx[0] - s0[0], sx[1] - s0[1]];
    var dy = [sy[0] - s0[0], sy[1] - s0[1]];
    var taps = [];
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        var fi = (i + 0.5) / 4 - 0.5;
        var fj = (j + 0.5) / 4 - 0.5;
        var t = [s0[0] + dx[0] * fi + dy[0] * fj, s0[1] + dx[1] * fi + dy[1] * fj];
        if (tapValid(cam, view, t)) taps.push(t);
      }
    }
    return taps;
  }

  // A tile's centre in the source comp, and its layer scale (source px per tile px), at the same mapping.
  // The tile's RA is unwrapped from its west edge, so a tile straddling the seam stays on the same side as the
  // sourcePoint mapping of its pixels.
  function tileLocal(L, row, col, view, cam) {
    var b = AstroImagery.tileBox(L, row, col);
    var westRa = relRa(b.ra0, cam.ra);
    var raMid = westRa + (b.ra1 - b.ra0) / 2;
    var decMid = (b.dec0 + b.dec1) / 2;
    return {
      x: raMid * view.scale + view.offset[0],
      y: decMid * view.scale + view.offset[1],
      scale: (b.ra1 - b.ra0) * view.scale / AstroImagery.TILE
    };
  }

  return {
    SOURCE_PX: SOURCE_PX,
    viewFor: viewFor,
    sourcePoint: sourcePoint,
    footprintTaps: footprintTaps,
    tileLocal: tileLocal
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroReproject;
