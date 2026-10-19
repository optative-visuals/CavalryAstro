// In-layer sky runtime: draws stars, constellation lines (with draw-on), borders and labels into a Path.
// Runs inside each sky layer's expression every frame, so it must never throw: a bad camera is repaired, not reported.
// It uses only AstroSky, AstroStars and the Path constructor it is given. The catalogue is not part of this runtime.
if (typeof AstroSky === "undefined" && typeof require !== "undefined") { var AstroSky = require("./sky.js"); }
if (typeof AstroStars === "undefined" && typeof require !== "undefined") { var AstroStars = require("./stars.js"); }

var AstroRender = (function () {
  var DEG = Math.PI / 180;
  // Stars with a radius at or below this are not worth a shape.
  var MIN_RADIUS = 0.05;
  // Angular length below which a segment is treated as zero and skipped.
  var EPS = 1e-12;
  var DEFAULT_FRAME_W = 1920;
  var DEFAULT_TEXT_SIZE = 18;

  function finite(v, fallback) {
    var n = Number(v);
    return (v === null || v === undefined || !isFinite(n)) ? fallback : n;
  }

  // The camera as the projector needs it. A projection other than stereographic is treated as 0, and the fov is
  // clamped, so a bad input draws a plausible view instead of throwing inside the layer.
  function safeCam(cam) {
    var c = cam || {};
    var fov = finite(c.fov, 60);
    if (fov < 0.5) fov = 0.5;
    if (fov > 220) fov = 220;
    return { ra: finite(c.ra, 0), dec: finite(c.dec, 0), fov: fov, rotation: finite(c.rotation, 0), projection: 0 };
  }

  function safeFrameW(frameW) {
    var w = Number(frameW);
    return w > 0 && isFinite(w) ? w : DEFAULT_FRAME_W;
  }

  // Projects a [ra, dec] point. Returns true when it is in front of the camera.
  function projectorFor(cam, frameW) {
    return AstroSky.makeProjector(safeCam(cam), safeFrameW(frameW));
  }

  // Unit vector of an [ra, dec] point, and back again. Working on vectors keeps the RA wrap out of the arithmetic.
  function toVector(ra, dec) {
    var a = ra * DEG, d = dec * DEG, c = Math.cos(d);
    return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
  }

  function fromVector(v) {
    return [Math.atan2(v[1], v[0]) / DEG, Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) / DEG];
  }

  // The point a fraction f of the way along the great circle from a to b (both [ra, dec]).
  function alongArc(a, b, f) {
    var va = toVector(a[0], a[1]), vb = toVector(b[0], b[1]);
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    var theta = Math.acos(dot), s = Math.sin(theta);
    if (s < EPS) return a;
    var wa = Math.sin((1 - f) * theta) / s, wb = Math.sin(f * theta) / s;
    return fromVector([wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]]);
  }

  function segmentLength(a, b) {
    return AstroSky.angularDistance(a[0], a[1], b[0], b[1]);
  }

  // Stars: one ellipse per star inside the view whose radius is above MIN_RADIUS.
  function stars(data, cam, frameW, opts, PathCtor) {
    var path = new PathCtor();
    var o = opts || {};
    var d = data || {};
    var ras = d.ra || [], decs = d.dec || [], mags = d.mag || [];
    var limit = o.ignoreLimit ? 99 : AstroStars.limitFor(finite(o.darkness, 100));
    // The size input is shared by a layer kind's stars; sizeScale is the layer's own multiple of it (the glow's 3).
    var size = finite(o.size, 1) * finite(o.sizeScale, 1);
    var project = projectorFor(cam, frameW), out = [0, 0];
    for (var i = 0; i < ras.length; i++) {
      var r = AstroStars.radius(mags[i], limit, size);
      if (!(r > MIN_RADIUS)) continue;
      if (!project(ras[i], decs[i], out)) continue;
      path.addEllipse(out[0], out[1], r, r);
    }
    return path;
  }

  // Each segment of each polyline, in order, with its angular length.
  function segmentsOf(lines) {
    var segs = [];
    for (var p = 0; p < lines.length; p++) {
      var line = lines[p] || [];
      for (var i = 0; i + 1 < line.length; i++) {
        segs.push({ line: p, a: line[i], b: line[i + 1], len: segmentLength(line[i], line[i + 1]) });
      }
    }
    return segs;
  }

  // Constellation lines. draw (0..1) is the share of the total angular length to draw, in order.
  // A segment is skipped when either end is behind the camera; the one that is cut by draw stops at its exact point.
  function lines(data, cam, frameW, opts, PathCtor) {
    var path = new PathCtor();
    var o = opts || {};
    var segs = segmentsOf((data && data.lines) || []);
    var total = 0;
    for (var t = 0; t < segs.length; t++) total += segs[t].len;
    var draw = Math.max(0, Math.min(1, finite(o.draw, 1)));
    var target = draw * total;
    if (!(target > EPS)) return path;
    var project = projectorFor(cam, frameW), pa = [0, 0], pb = [0, 0];
    var acc = 0, pen = false, prevLine = -1, done = false;
    for (var s = 0; s < segs.length && !done; s++) {
      var seg = segs[s];
      if (seg.line !== prevLine) { pen = false; prevLine = seg.line; }
      if (!(seg.len > EPS)) continue;
      var rem = target - acc, end = seg.b;
      if (seg.len > rem + EPS) {
        var f = rem / seg.len;
        done = true;
        if (!(f > EPS)) break;
        end = alongArc(seg.a, seg.b, Math.min(1, f));
      }
      acc += seg.len;
      var visA = project(seg.a[0], seg.a[1], pa);
      var visB = project(end[0], end[1], pb);
      if (!visA || !visB) { pen = false; continue; }
      if (!pen) path.moveTo(pa[0], pa[1]);
      path.lineTo(pb[0], pb[1]);
      pen = !done;
    }
    return path;
  }

  // Constellation borders: each ring closed, broken where points are hidden. data.rings = [ring, ...] with
  // each ring = [[ra, dec], ...].
  function border(data, cam, frameW, opts, PathCtor) {
    var path = new PathCtor();
    var rings = (data && data.rings) || [];
    var project = projectorFor(cam, frameW), pa = [0, 0], pb = [0, 0];
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r] || [], n = ring.length;
      if (n < 2) continue;
      var pen = false;
      // Cyclic: the last segment runs back to the first point, which closes the ring.
      for (var i = 0; i < n; i++) {
        var a = ring[i], b = ring[(i + 1) % n];
        if (!(segmentLength(a, b) > EPS)) continue;
        var visA = project(a[0], a[1], pa);
        var visB = project(b[0], b[1], pb);
        if (!visA || !visB) { pen = false; continue; }
        if (!pen) path.moveTo(pa[0], pa[1]);
        path.lineTo(pb[0], pb[1]);
        pen = true;
      }
    }
    return path;
  }

  // Labels: text at each visible item's projected point, offset by dx, dy.
  function texts(data, cam, frameW, opts, PathCtor) {
    var path = new PathCtor();
    var o = opts || {};
    var size = finite(o.size, DEFAULT_TEXT_SIZE), dx = finite(o.dx, 0), dy = finite(o.dy, 0);
    var items = (data && data.items) || [];
    var project = projectorFor(cam, frameW), out = [0, 0];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!project(it[1], it[2], out)) continue;
      path.addText(String(it[0]), size, out[0] + dx, out[1] + dy);
    }
    return path;
  }

  return {
    stars: stars,
    lines: lines,
    border: border,
    texts: texts
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroRender;
