// Smooth camera flights and drifts on the sphere: the view centre travels the great circle, and the
// field of view follows a van Wijk & Nuij zoom-and-travel curve (as Cavalry Geo's flyto.js does on a map,
// here in angular units). Pure: the scene samples these paths into keyframes.
if (typeof AstroSky === "undefined" && typeof require !== "undefined") { var AstroSky = require("./sky.js"); }

var AstroFly = (function () {
  var DEG = Math.PI / 180, RHO = Math.SQRT2, EPS = 1e-12, FOV_MIN = 1, FOV_MAX = 180;
  var OVERSHOOT_AT = 0.85, OVERSHOOT_FOV = 0.75, DRIFT_IN = 0.85, DRIFT_PAN = 0.05, POLE_DEC = 89.999;

  function cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }
  function sinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }
  function tanh(x) { var e = Math.exp(2 * x); return (e - 1) / (e + 1); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function gentle(t) { return 0.5 - Math.cos(Math.PI * t) / 2; }
  function snappy(t) { return t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2; }

  var EASINGS = [{ id: "smooth", name: "Smooth" }, { id: "gentle", name: "Gentle" }, { id: "snappy", name: "Snappy" }, { id: "overshoot", name: "Overshoot" }];
  var ARCS = [{ id: "low", name: "Low", rho: 1.0 }, { id: "normal", name: "Normal", rho: RHO }, { id: "high", name: "High", rho: 2.0 }];
  var DRIFTS = [{ id: "in", name: "Push in" }, { id: "out", name: "Pull out" }, { id: "left", name: "Pan left" },
    { id: "right", name: "Pan right" }, { id: "up", name: "Pan up" }, { id: "down", name: "Pan down" }];

  // The overshoot easing's own curve is the smooth one (path() adds the settle phase).
  function easing(id) { return id === "gentle" ? gentle : id === "snappy" ? snappy : ease; }
  function arcRho(id) { for (var i = 0; i < ARCS.length; i++) if (ARCS[i].id === id) return ARCS[i].rho; return RHO; }
  function clampFov(f) { return Math.max(FOV_MIN, Math.min(FOV_MAX, f)); }

  // One-dimensional van Wijk & Nuij curve: distance d to travel, widths w0 to w1. Returns f(t) giving [u, w].
  function interpolator(d, w0, w1, rho) {
    var RHO2 = rho * rho; if (Math.abs(RHO2 - Math.round(RHO2)) < 1e-12) RHO2 = Math.round(RHO2); // sqrt(2)^2 gives exactly 2
    var RHO4 = RHO2 * RHO2, d2 = d * d;
    if (d2 < EPS) {
      var S0 = Math.log(w1 / w0) / rho;
      return function (t) { return [0, w0 * Math.exp(rho * t * S0)]; };
    }
    var b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d);
    var b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d);
    var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    var S = (r1 - r0) / rho, coshr0 = cosh(r0);
    return function (t) {
      var s = t * S;
      return [w0 / (RHO2 * d) * (coshr0 * tanh(rho * s + r0) - sinh(r0)), w0 * coshr0 / cosh(rho * s + r0)];
    };
  }

  // Unit vector of a [ra, dec] point, and back.
  function unit(ra, dec) { var a = ra * DEG, d = dec * DEG, c = Math.cos(d); return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)]; }
  function radec(v) {
    return { ra: AstroSky.wrapRa(Math.atan2(v[1], v[0]) / DEG), dec: Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) / DEG };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(v) { var l = Math.sqrt(dot(v, v)); return [v[0] / l, v[1] / l, v[2] / l]; }

  // Point a fraction f of the way along the great circle from a to b (unit vectors).
  // Antipodal ends have no unique circle, so the path goes over a perpendicular great circle.
  function slerp(a, b, f) {
    var c = cross(a, b), s = Math.sqrt(dot(c, c)), theta = Math.atan2(s, dot(a, b));
    if (s < 1e-10) {
      if (dot(a, b) > 0) return a;
      var p = norm(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      return [0, 1, 2].map(function (i) { return Math.cos(Math.PI * f) * a[i] + Math.sin(Math.PI * f) * p[i]; });
    }
    return [0, 1, 2].map(function (i) { return (Math.sin((1 - f) * theta) * a[i] + Math.sin(f * theta) * b[i]) / s; });
  }

  // Flight: from and to are {ra, dec, fov}; opts = {easing: id, arc: id}; no opts = smooth easing on the normal arc.
  // Returns frames + 1 views, the first exactly from and the last exactly to (fov clamped to 1..180).
  function path(from, to, frames, opts) {
    frames = Math.round(Number(frames) || 0);
    if (frames < 1) throw new Error("Use at least 1 frame.");
    opts = opts || {};
    var rho = arcRho(opts.arc), ez = easing(opts.easing), over = opts.easing === "overshoot";
    var f0 = clampFov(from.fov), f1 = clampFov(to.fov);
    var u1 = AstroSky.angularDistance(from.ra, from.dec, to.ra, to.dec);
    var a = unit(from.ra, from.dec), b = unit(to.ra, to.dec);
    var peak = over ? clampFov(f1 * OVERSHOOT_FOV) : f1;
    var f = interpolator(u1, f0, peak, rho);
    var out = [];
    for (var k = 0; k <= frames; k++) {
      var t = k / frames, view;
      if (over && t > OVERSHOOT_AT + 1e-9) { // phase 2: position held, fov settles back to the target
        view = { pos: 1, fov: peak + (f1 - peak) * gentle((t - OVERSHOOT_AT) / (1 - OVERSHOOT_AT)) };
      } else if (over && t >= OVERSHOOT_AT - 1e-9) { // end of phase 1: on the destination at the peak fov
        view = { pos: 1, fov: peak };
      } else {
        var v = f(ez(over ? t / OVERSHOOT_AT : t));
        view = { pos: Math.max(0, Math.min(1, v[0])), fov: v[1] };
      }
      var p = radec(slerp(a, b, view.pos));
      out.push({ ra: p.ra, dec: p.dec, fov: clampFov(view.fov) });
    }
    pinEnds(out, from, to, f0, f1);
    return out;
  }

  // Endpoints are exact, except that an endpoint on the pole takes its neighbour's RA: at the pole RA only
  // sets the screen roll, so the requested RA would turn the sky in one frame. Its dec and fov stay exact.
  function pinEnds(out, from, to, f0, f1) {
    var last = out.length - 1;
    out[0] = { ra: AstroSky.wrapRa(isPole(from.dec) ? out[1].ra : from.ra), dec: from.dec, fov: f0 };
    out[last] = { ra: AstroSky.wrapRa(isPole(to.dec) ? out[last - 1].ra : to.ra), dec: to.dec, fov: f1 };
  }
  function isPole(dec) { return Math.abs(dec) >= POLE_DEC; }

  // End view of a drift. Push in / Pull out change fov by 15 % (x 0.85, or / 0.85). The pans move the
  // centre 5 % of fov across the screen. East is on the left, so Pan left increases RA at rotation 0.
  function driftEnd(cam, move) {
    var fov = clampFov(cam.fov), res = { ra: cam.ra, dec: cam.dec, fov: fov };
    if (move === "in") { res.fov = clampFov(fov * DRIFT_IN); return res; }
    if (move === "out") { res.fov = clampFov(fov / DRIFT_IN); return res; }
    var dir = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[move];
    if (!dir) return res;
    // The screen point 5 % of fov away from the centre, found with the projector's inverse at a frame of width 2:
    // its planar radius is 2 tan(angle / 2) and the scale at this fov is 1 / (2 tan(fov / 4)).
    var angle = DRIFT_PAN * fov * DEG, k = Math.tan(angle / 2) / Math.tan(fov * DEG / 4);
    var q = AstroSky.unproject({ ra: cam.ra, dec: cam.dec, fov: fov, rotation: cam.rotation || 0, projection: 0 }, 2, dir[0] * k, dir[1] * k);
    res.ra = q[0]; res.dec = q[1];
    return res;
  }

  // Straight, eased travel from start to end: the centre on the great circle, fov eased between the two.
  // Returns frames + 1 views with exact endpoints. easingId defaults to gentle.
  function driftPath(from, to, frames, easingId) {
    frames = Math.round(Number(frames) || 0);
    if (frames < 1) throw new Error("Use at least 1 frame.");
    var ez = easingId === undefined ? gentle : easing(easingId);
    var f0 = clampFov(from.fov), f1 = clampFov(to.fov);
    var a = unit(from.ra, from.dec), b = unit(to.ra, to.dec), out = [];
    for (var k = 0; k <= frames; k++) {
      var g = ez(k / frames), p = radec(slerp(a, b, g));
      out.push({ ra: p.ra, dec: p.dec, fov: clampFov(f0 + (f1 - f0) * g) });
    }
    pinEnds(out, from, to, f0, f1);
    return out;
  }

  return { path: path, ease: ease, easing: easing, EASINGS: EASINGS, ARCS: ARCS, DRIFTS: DRIFTS, driftEnd: driftEnd, driftPath: driftPath };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroFly;
