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
    var scale = SOURCE_PX * (1 - 2 * MARGIN) / span;
    var decMid = (dec0 + dec1) / 2;
    return {
      ra0: cam.ra - halfRa,
      ra1: cam.ra + halfRa,
      dec0: dec0,
      dec1: dec1,
      scale: scale,
      offset: [SOURCE_PX / 2, SOURCE_PX / 2 - decMid * scale]
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
    tileLocal: tileLocal
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroReproject;
