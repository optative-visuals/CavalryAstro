// Sky maths: angles on the sphere, and the stereographic projector that draws the sky from inside it.
// Convention: north celestial pole up (+y), east to the left (-x). RA and Dec are in degrees.
// No dependencies, so this file can also run inside a Cavalry layer expression.
var AstroSky = (function () {
  var DEG = Math.PI / 180;
  // Points further than this from the camera centre are clamped to the circle and reported as outside.
  var CLAMP_DEG = 120;

  // RA into [0,360).
  function wrapRa(ra) {
    var r = ra % 360;
    if (r < 0) r += 360;
    if (r >= 360) r -= 360;
    return r === 0 ? 0 : r;
  }

  // The copy of ra (ra + 360k) closest to ref.
  function nearestRa(ra, ref) {
    var d = ((ra - ref + 180) % 360 + 360) % 360 - 180;
    return ref + d;
  }

  // Great-circle distance in degrees (Vincenty form: stable at small and antipodal separations).
  function angularDistance(ra1, dec1, ra2, dec2) {
    var s1 = Math.sin(dec1 * DEG), c1 = Math.cos(dec1 * DEG);
    var s2 = Math.sin(dec2 * DEG), c2 = Math.cos(dec2 * DEG);
    var dA = (ra2 - ra1) * DEG;
    var sA = Math.sin(dA), cA = Math.cos(dA);
    var num = Math.sqrt(c2 * sA * c2 * sA + (c1 * s2 - s1 * c2 * cA) * (c1 * s2 - s1 * c2 * cA));
    var den = s1 * s2 + c1 * c2 * cA;
    return Math.atan2(num, den) / DEG;
  }

  // Spherical mean of [ra, dec] points, averaging unit vectors so that RA wrap-around does not matter.
  function mid(points) {
    var x = 0, y = 0, z = 0;
    for (var i = 0; i < points.length; i++) {
      var ra = points[i][0] * DEG, dec = points[i][1] * DEG, c = Math.cos(dec);
      x += c * Math.cos(ra);
      y += c * Math.sin(ra);
      z += Math.sin(dec);
    }
    return [wrapRa(Math.atan2(y, x) / DEG), Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG];
  }

  // Pixels per unit of the projection's planar radius. The planar radius is 2·tan(c/2), c = angle from centre.
  function scaleOf(cam, frameW) {
    return (frameW / 2) / (2 * Math.tan(cam.fov * DEG / 4));
  }

  function checkProjection(cam) {
    if (cam.projection !== undefined && cam.projection !== 0) {
      throw new Error("Unsupported projection " + cam.projection + ": only stereographic (0) exists in v0.1");
    }
  }

  // Returns project(ra, dec, out): writes Cavalry pixels (centre at 0,0) into out and returns true when
  // the point is within 120 degrees of the centre. Beyond that it writes the point clamped to the 120 degree circle.
  function makeProjector(cam, frameW) {
    checkProjection(cam);
    var a0 = cam.ra * DEG, d0 = cam.dec * DEG;
    var sd0 = Math.sin(d0), cd0 = Math.cos(d0);
    var rot = (cam.rotation || 0) * DEG, cr = Math.cos(rot), sr = Math.sin(rot);
    var scale = scaleOf(cam, frameW);
    var clampR = 2 * Math.tan(CLAMP_DEG * DEG / 2);
    var cosClamp = Math.cos(CLAMP_DEG * DEG);

    return function (ra, dec, out) {
      var dA = ra * DEG - a0;
      var sA = Math.sin(dA), cA = Math.cos(dA);
      var sd = Math.sin(dec * DEG), cd = Math.cos(dec * DEG);
      // (dx, dy) is the tangent-plane direction times sin(c).
      var dx = -cd * sA;
      var dy = cd0 * sd - sd0 * cd * cA;
      var cosC = sd0 * sd + cd0 * cd * cA;
      var inside = cosC >= cosClamp;
      var X, Y;
      if (inside) {
        var k = 2 / (1 + cosC);
        X = k * dx;
        Y = k * dy;
      } else {
        // Keep the bearing from the centre, put the radius at the clamp circle.
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) { X = dx / len * clampR; Y = dy / len * clampR; }
        else { X = 0; Y = clampR; }
      }
      var px = scale * X, py = scale * Y;
      out[0] = px * cr - py * sr;
      out[1] = px * sr + py * cr;
      return inside;
    };
  }

  // Inverse of makeProjector: Cavalry pixels back to [ra, dec] in degrees.
  function unproject(cam, frameW, x, y) {
    checkProjection(cam);
    var scale = scaleOf(cam, frameW);
    var rot = (cam.rotation || 0) * DEG, cr = Math.cos(rot), sr = Math.sin(rot);
    var px = x / scale, py = y / scale;
    // Undo the rotation.
    var X = px * cr + py * sr, Y = -px * sr + py * cr;
    var r = Math.sqrt(X * X + Y * Y);
    var ux = r > 0 ? X / r : 0, uy = r > 0 ? Y / r : 0;
    // Planar radius r = 2·tan(c/2), so sin c and cos c follow directly.
    var sinC = 4 * r / (4 + r * r), cosC = (4 - r * r) / (4 + r * r);
    // Point = cos c · centre + sin c · (east · -ux + north · uy), with east = -x and north = +y.
    var a0 = cam.ra * DEG, d0 = cam.dec * DEG;
    var sA0 = Math.sin(a0), cA0 = Math.cos(a0), sd0 = Math.sin(d0), cd0 = Math.cos(d0);
    var e = -ux * sinC, nn = uy * sinC;
    var vx = cosC * cd0 * cA0 + e * (-sA0) + nn * (-sd0 * cA0);
    var vy = cosC * cd0 * sA0 + e * cA0 + nn * (-sd0 * sA0);
    var vz = cosC * sd0 + nn * cd0;
    return [wrapRa(Math.atan2(vy, vx) / DEG), Math.atan2(vz, Math.sqrt(vx * vx + vy * vy)) / DEG];
  }

  // Pixels per degree at the centre of the view.
  function pixelsPerDegree(cam, frameW) {
    return scaleOf(cam, frameW) * DEG;
  }

  return {
    angularDistance: angularDistance,
    wrapRa: wrapRa,
    nearestRa: nearestRa,
    mid: mid,
    makeProjector: makeProjector,
    unproject: unproject,
    pixelsPerDegree: pixelsPerDegree
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroSky;
