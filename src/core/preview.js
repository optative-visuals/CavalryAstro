// Sky preview maths: the preview's own wide view of the sky (stereographic, north up, east left), pan and zoom,
// the green frame where the camera will go, the dashed outline of where it is now, and hit-tests.
// Pixels here are view pixels: origin top-left, y down. AstroSky works in Cavalry pixels (centre 0,0, y up),
// so the helpers below convert. No state: the panel keeps the view and redraws with these.
if (typeof AstroSky === "undefined" && typeof require !== "undefined") { var AstroSky = require("./sky.js"); }
if (typeof AstroCatalog === "undefined" && typeof require !== "undefined") { var AstroCatalog = require("./catalog.js"); }

var AstroPreview = (function () {
  var DEG = Math.PI / 180;
  // The green frame's width as a share of the preview's width.
  var FRAME_FRACTION = 0.6;
  var MIN_FOV = 5, MAX_FOV = 180, DEFAULT_FOV = 100, DEFAULT_RA = 84, DEFAULT_DEC = 0;
  // Reference width for the camera outline's corners: a pixel scale only, the comp's size comes in as an aspect.
  var REF_WIDTH = 1920;
  // Dragging near the pole: cos(dec) never drops below this, so the RA step stays finite.
  var COS_FLOOR = 1e-3;
  // A middle-drag doubles or halves the fov every ZOOM_DRAG_PX pixels.
  var ZOOM_DRAG_PX = 100;
  var PREVIEW_MAG = 4.5;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // The view as the projector takes it: no rotation, stereographic.
  function camOf(v) { return { ra: v.ra, dec: v.dec, fov: v.fov, rotation: 0, projection: 0 }; }

  // View pixels (y down, origin top-left) to and from Cavalry pixels (centre 0,0, y up).
  function toCentred(x, y, w, h) { return [x - w / 2, h / 2 - y]; }
  function toView(px, py, w, h) { return [px + w / 2, h / 2 - py]; }

  // Pixels per degree at the centre of the view.
  function pixelsPerDegree(v, w) { return AstroSky.pixelsPerDegree(camOf(v), w); }

  function defaultView() { return { ra: DEFAULT_RA, dec: DEFAULT_DEC, fov: DEFAULT_FOV }; }

  // View pixels of a sky point, or null when it is beyond the projector's 120 degree limit.
  function toPx(v, ra, dec, w, h) {
    var out = [0, 0];
    var inside = AstroSky.makeProjector(camOf(v), w)(ra, dec, out);
    if (!inside) return null;
    return toView(out[0], out[1], w, h);
  }

  // Moves the view as if the sky under the mouse had been dragged by (dxPx, dyPx) view pixels (y down):
  // dragging right brings more of the east (left) into view, so RA increases; dragging down brings the north
  // into view, so dec increases. Dec is clamped to ±90 and RA wrapped into [0, 360).
  function pan(v, dxPx, dyPx, widthPx) {
    var k = pixelsPerDegree(v, widthPx);
    var dec = clamp(v.dec + dyPx / k, -90, 90);
    // A sideways drag is a fixed arc on the sky, which is more RA the closer to the pole it is.
    var c = Math.max(Math.cos((v.dec + dec) / 2 * DEG), COS_FLOOR);
    return { ra: AstroSky.wrapRa(v.ra + dxPx / k / c), dec: dec, fov: v.fov };
  }

  // Zooms by factor (above 1 zooms in) keeping the view point (x, y) still. The fov stays in [5, 180].
  // Pan corrects the view until the point is back under the cursor, within a fraction of a pixel.
  function zoomAt(v, factor, x, y, w, h) {
    var fov = clamp(v.fov / factor, MIN_FOV, MAX_FOV);
    if (fov === v.fov) return v;
    var c = toCentred(x, y, w, h);
    var anchor = AstroSky.unproject(camOf(v), w, c[0], c[1]);
    var out = { ra: anchor[0], dec: anchor[1], fov: fov };
    for (var i = 0; i < 30; i++) {
      var p = toPx(out, anchor[0], anchor[1], w, h);
      if (!p) break;
      var dx = x - p[0], dy = y - p[1];
      if (dx * dx + dy * dy < 1e-8) break;
      out = pan(out, dx, dy, w);
    }
    return out;
  }

  // Middle-drag zoom: from the view at the press (startView, startX, startY), dragging to y zooms by a factor
  // of two per ZOOM_DRAG_PX pixels (up is in), keeping the press point still. View pixels, y down.
  function dragZoom(startView, startX, startY, y, w, h) {
    return zoomAt(startView, Math.pow(2, (startY - y) / ZOOM_DRAG_PX), startX, startY, w, h);
  }

  // The camera the green frame stands for, exactly: the same centre, and a horizontal fov whose half-width on the
  // stereographic plane is FRAME_FRACTION of the view's, so 4 atan(FRAME_FRACTION tan(fov/4)) (degrees).
  function frameCamera(v) {
    return { ra: v.ra, dec: v.dec, fov: 4 * Math.atan(FRAME_FRACTION * Math.tan(v.fov * DEG / 4)) / DEG };
  }

  // The view's fov whose green frame camera has camFov (degrees): the inverse of frameCamera, so a pick can show
  // the camera it will fly to exactly.
  function viewFovFor(camFov) {
    return 4 * Math.atan(Math.tan(camFov * DEG / 4) / FRAME_FRACTION) / DEG;
  }

  // The green frame in view pixels: FRAME_FRACTION of the width, centred, at the comp's aspect (and no taller
  // than FRAME_FRACTION of the height).
  function frameRect(w, h, aspect) {
    var fw = FRAME_FRACTION * w, fh = fw / aspect;
    if (fh > FRAME_FRACTION * h) { fh = FRAME_FRACTION * h; fw = fh * aspect; }
    return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
  }

  // The dashed outline of a camera ({ra, dec, fov, rotation}) at the comp's aspect (width / height): the bounding
  // box of its frame's corners in the view, as [x0, y0, x1, y1]. Null when a corner is beyond the projector's
  // limit (the camera is off the view).
  function cameraRect(v, cam, w, h, aspect) {
    var cc = { ra: cam.ra, dec: cam.dec, fov: cam.fov, rotation: cam.rotation || 0, projection: 0 };
    var halfW = REF_WIDTH / 2, halfH = halfW / aspect;
    var corners = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < corners.length; i++) {
      var sky = AstroSky.unproject(cc, REF_WIDTH, corners[i][0], corners[i][1]);
      var p = toPx(v, sky[0], sky[1], w, h);
      if (!p) return null;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1];
  }

  // Index of the nearest point (view pixels) within radius of (x, y), or -1.
  function hitDot(points, x, y, radius) {
    var best = -1, bestD = radius * radius;
    for (var i = 0; i < points.length; i++) {
      var dx = points[i][0] - x, dy = points[i][1] - y, d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Index of the constellation under view pixel (x, y), or -1.
  function hitConstellation(v, cons, x, y, w, h) {
    var c = toCentred(x, y, w, h);
    var sky = AstroSky.unproject(camOf(v), w, c[0], c[1]);
    return AstroCatalog.constellationAt(cons, sky[0], sky[1]);
  }

  // Dash segments along a polyline ([[x, y], ...]), the pattern carrying on round corners.
  function dashPolyline(pts, dash, gap) {
    var segs = [], phase = 0;
    for (var e = 0; e + 1 < pts.length; e++) {
      var ax = pts[e][0], ay = pts[e][1], bx = pts[e + 1][0], by = pts[e + 1][1];
      var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), pos = 0;
      while (pos < len) {
        var inDash = phase < dash, step = Math.min(len - pos, inDash ? dash - phase : dash + gap - phase);
        if (inDash) {
          var t0 = pos / len, t1 = (pos + step) / len;
          segs.push([ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1]);
        }
        pos += step; phase = (phase + step) % (dash + gap);
      }
    }
    return segs;
  }

  // Dash segments along a rectangle's outline ({x, y, w, h}), clockwise from the top-left corner.
  function dashes(rect, dash, gap) {
    return dashPolyline([[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h], [rect.x, rect.y]], dash, gap);
  }

  // The stars the preview draws: those at or brighter than maxMag (default 4.5), in typed arrays.
  function starsForPreview(stars, maxMag) {
    var lim = maxMag === undefined ? PREVIEW_MAG : maxMag, keep = [];
    for (var i = 0; i < stars.count; i++) if (stars.mag[i] <= lim) keep.push(i);
    var F = typeof Float64Array !== "undefined" ? Float64Array : Array;
    var out = { count: keep.length, ra: new F(keep.length), dec: new F(keep.length), mag: new F(keep.length), bv: new F(keep.length) };
    for (var k = 0; k < keep.length; k++) {
      var j = keep[k];
      out.ra[k] = stars.ra[j]; out.dec[k] = stars.dec[j]; out.mag[k] = stars.mag[j]; out.bv[k] = stars.bv[j];
    }
    return out;
  }

  return {
    FRAME_FRACTION: FRAME_FRACTION, ZOOM_DRAG_PX: ZOOM_DRAG_PX,
    defaultView: defaultView, toPx: toPx, pixelsPerDegree: pixelsPerDegree,
    pan: pan, zoomAt: zoomAt, dragZoom: dragZoom, frameCamera: frameCamera, viewFovFor: viewFovFor, frameRect: frameRect,
    cameraRect: cameraRect, hitDot: hitDot, hitConstellation: hitConstellation, dashes: dashes,
    starsForPreview: starsForPreview
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroPreview;
