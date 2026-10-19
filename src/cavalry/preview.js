// The sky preview, used by the Sky page: a ui.Draw showing the sky (stars, constellation lines and names, search
// results), with a green frame where the camera will go and a dashed outline of where it is now. Drag to pan,
// middle-drag or the + / − squares to zoom, click a constellation to pick it. AstroPreview does the maths.
// Like GeoPreviewPanel: ui.Draw is y-up and has no mouse wheel; setSize locks the minimum size, so the minimum
// is set again after it; there is no mouse-leave, so a new press always starts afresh. Redraws are coalesced
// by a 40 ms timer while the mouse moves.
var AstroPreviewPanel = (function () {
  var HEADING = "Preview (drag to move)";
  var HINT = "Drag to move · middle-drag or + / − to zoom · click a constellation to pick it";
  var CAMERA = "#e6e6e6", PILL = "#000000a6", GLYPH = "#e6e6e6";
  var MIN_WIDTH = 120; // the narrowest the Draw can be
  var TICK_MS = 40, DOT_HIT = 6, DOT_RADIUS = 3, CLICK_PX = 4, ZOOM_STEP = 1.5;
  // Stars: radius from AstroStars at this limit and size. Fainter than the minimum radius is still a dot.
  var STAR_LIMIT = 7, STAR_SIZE = 0.7, STAR_MIN_RADIUS = 0.6;
  // Constellation names show once the view is narrower than this many degrees.
  var NAME_FOV = 90;
  // The comp's size until the panel is told otherwise: the preview is shaped like it.
  var DEFAULT_COMP_W = 1920, DEFAULT_COMP_H = 1080;

  function create(opts) {
    opts = opts || {};
    var layout = new ui.VLayout();
    if (typeof layout.setMargins === "function") layout.setMargins(0, 0, 0, 0);
    var heading = new ui.Label(HEADING);
    var draw = new ui.Draw();
    layout.add(heading);
    layout.add(draw);

    var defaultColours = AstroStyles.previewColors(AstroStyles.find("Realistic", []));
    var state = {
      view: AstroPreview.defaultView(), w: 320, h: 180, sized: false, comp: { w: DEFAULT_COMP_W, h: DEFAULT_COMP_H },
      sky: null, colours: defaultColours, results: [], resultPts: [], current: null,
      onPick: typeof opts.onPick === "function" ? opts.onPick : null, stats: { stars: 0, lines: 0, names: 0 }
    };
    var dirty = false, timer = null, running = false;
    var onPress = typeof opts.onPress === "function" ? opts.onPress : null;
    var press = null, drag = null, panning = false, zoomDrag = null;

    function Y(y) { return state.h - y; } // Draw is y-up; the maths is y-down

    function rectPath(r) {
      var path = new cavalry.Path();
      path.moveTo(r.x, Y(r.y)); path.lineTo(r.x + r.w, Y(r.y)); path.lineTo(r.x + r.w, Y(r.y + r.h)); path.lineTo(r.x, Y(r.y + r.h));
      path.close();
      return path.toObject();
    }
    function inside(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
    function overlayRects() {
      var plus = { x: state.w - 28, y: state.h - 28, w: 20, h: 20 };
      var minus = { x: plus.x - 24, y: plus.y, w: 20, h: 20 };
      return { readout: { x: 8, y: plus.y, w: readoutText().length * 6 + 12, h: 20 }, minus: minus, plus: plus };
    }
    function readoutText() { return "FOV " + state.view.fov.toFixed(0) + "°"; }

    // The projector's Cavalry pixels (centre 0,0, y up) as view pixels (y down, origin top-left), or null when
    // the point is beyond its 120 degree limit or off the view.
    function onView(proj, ra, dec, out) {
      if (!proj(ra, dec, out)) return null;
      var x = out[0] + state.w / 2, y = state.h / 2 - out[1];
      return x < 0 || x > state.w || y < 0 || y > state.h ? null : [x, y];
    }

    function drawStars(proj, out) {
      var s = state.sky.stars, path = new cavalry.Path(), n = 0;
      for (var i = 0; i < s.count; i++) {
        var q = onView(proj, s.ra[i], s.dec[i], out);
        if (!q) continue;
        var r = Math.max(STAR_MIN_RADIUS, AstroStars.radius(s.mag[i], STAR_LIMIT, STAR_SIZE));
        path.addEllipse(q[0], Y(q[1]), r, r);
        n++;
      }
      draw.addPath(path.toObject(), { color: state.colours.star });
      state.stats.stars = n;
    }

    function drawLines(proj, out) {
      var path = new cavalry.Path(), points = 0;
      state.sky.constellations.forEach(function (c) {
        (c.lines || []).forEach(function (line) {
          var pen = false;
          line.forEach(function (pt) {
            var q = onView(proj, pt[0], pt[1], out);
            if (!q) { pen = false; return; }
            if (!pen) path.moveTo(q[0], Y(q[1])); else path.lineTo(q[0], Y(q[1]));
            pen = true; points++;
          });
        });
      });
      draw.addPath(path.toObject(), { color: state.colours.lines, stroke: true, strokeWidth: 1 });
      state.stats.lines = points;
    }

    function drawNames(proj, out) {
      var path = new cavalry.Path(), n = 0;
      state.sky.constellations.forEach(function (c) {
        var q = onView(proj, c.centre[0], c.centre[1], out);
        if (!q) return;
        path.addText(String(c.latin).replace(/</g, ""), 10, q[0], Y(q[1]));
        n++;
      });
      draw.addPath(path.toObject(), { color: state.colours.names });
      state.stats.names = n;
    }

    function drawResults(proj, out) {
      var dots = new cavalry.Path();
      state.resultPts = state.results.map(function (r) {
        var q = onView(proj, r.ra, r.dec, out);
        if (q) dots.addEllipse(q[0], Y(q[1]), DOT_RADIUS, DOT_RADIUS);
        return q;
      });
      draw.addPath(dots.toObject(), { color: state.colours.frame });
    }

    // The search result under a press (view pixels), or -1.
    function resultAt(x, y) {
      var idx = [], pts = [];
      state.resultPts.forEach(function (q, i) { if (q) { idx.push(i); pts.push(q); } });
      var hit = AstroPreview.hitDot(pts, x, y, DOT_HIT);
      return hit >= 0 ? idx[hit] : -1;
    }

    function drawCamera() {
      var r = AstroPreview.cameraRect(state.view, state.current, state.w, state.h, state.comp.w / state.comp.h);
      if (!r) return;
      var segs = AstroPreview.dashes({ x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] }, 4, 3), dash = new cavalry.Path();
      segs.forEach(function (sg) { dash.moveTo(sg[0], Y(sg[1])); dash.lineTo(sg[2], Y(sg[3])); });
      draw.addPath(dash.toObject(), { color: CAMERA, stroke: true, strokeWidth: 1.2 });
    }

    function drawOverlay() {
      var o = overlayRects(), glyphs = new cavalry.Path(), label = new cavalry.Path();
      [o.readout, o.minus, o.plus].forEach(function (r) { draw.addPath(rectPath(r), { color: PILL }); });
      [o.minus, o.plus].forEach(function (r) {
        glyphs.moveTo(r.x + 5, Y(r.y + 9)); glyphs.lineTo(r.x + 15, Y(r.y + 9)); glyphs.lineTo(r.x + 15, Y(r.y + 11)); glyphs.lineTo(r.x + 5, Y(r.y + 11)); glyphs.close();
      });
      glyphs.moveTo(o.plus.x + 9, Y(o.plus.y + 5)); glyphs.lineTo(o.plus.x + 11, Y(o.plus.y + 5)); glyphs.lineTo(o.plus.x + 11, Y(o.plus.y + 15));
      glyphs.lineTo(o.plus.x + 9, Y(o.plus.y + 15)); glyphs.close();
      draw.addPath(glyphs.toObject(), { color: GLYPH });
      label.addText(readoutText(), 10, o.readout.x + 6, Y(o.readout.y + 14));
      draw.addPath(label.toObject(), { color: GLYPH });
    }

    // Draws everything now: the background, the stars, the lines, the names (when zoomed in), the search results,
    // the green frame, the dashed camera outline and the overlay.
    function render() {
      dirty = false;
      draw.clearPaths();
      if (state.sky) {
        var out = [0, 0];
        var proj = AstroSky.makeProjector(camOfView(), state.w);
        drawStars(proj, out);
        drawLines(proj, out);
        if (state.view.fov < NAME_FOV) drawNames(proj, out);
        drawResults(proj, out);
      }
      var f = AstroPreview.frameRect(state.w, state.h, state.comp.w / state.comp.h);
      draw.addPath(rectPath(f), { color: state.colours.frame, stroke: true, strokeWidth: 2 });
      if (state.current) drawCamera();
      drawOverlay();
      draw.redraw();
    }
    function camOfView() { return { ra: state.view.ra, dec: state.view.dec, fov: state.view.fov, rotation: 0, projection: 0 }; }

    function Tick() {
      this.onTimeout = function () {
        if (dirty) { render(); return; }
        timer.stop();
        running = false;
      };
    }
    // A change is drawn on the next tick, so a fast drag redraws about 25 times a second at most.
    function changed() {
      dirty = true;
      if (!timer) { timer = new api.Timer(new Tick()); timer.setRepeating(true); timer.setInterval(TICK_MS); }
      if (!running) { running = true; timer.start(); }
    }

    function pick(i) { if (i >= 0 && state.onPick) state.onPick(i); }

    function zoom(factor) {
      state.view = AstroPreview.zoomAt(state.view, factor, state.w / 2, state.h / 2, state.w, state.h);
      changed();
    }

    draw.setBackgroundColor(state.colours.background);
    if (typeof draw.useHoverEvents === "function") draw.useHoverEvents(true);
    if (typeof draw.setToolTip === "function") draw.setToolTip(HINT);

    draw.onMousePress = function (pos, button) {
      if (onPress) onPress(); // the panel catches up with the canvas on any press
      press = null; drag = null; panning = false; zoomDrag = null;
      var y = Y(pos.y);
      if (button === "middle") { zoomDrag = { x: pos.x, y: y, view: state.view }; return; }
      if (button && button !== "left") return;
      var o = overlayRects();
      if (inside(o.minus, pos.x, y)) { zoom(1 / ZOOM_STEP); return; }
      if (inside(o.plus, pos.x, y)) { zoom(ZOOM_STEP); return; }
      if (inside(o.readout, pos.x, y)) return;
      var hit = resultAt(pos.x, y);
      if (hit >= 0) {
        // A press on a search result picks the constellation the result is in.
        var r = state.results[hit];
        if (state.sky) pick(AstroCatalog.constellationAt(state.sky.constellations, r.ra, r.dec));
        return;
      }
      drag = { x: pos.x, y: y }; press = { x: pos.x, y: y };
    };
    draw.onMouseMove = function (pos) {
      var y = Y(pos.y);
      if (zoomDrag) {
        state.view = AstroPreview.dragZoom(zoomDrag.view, zoomDrag.x, zoomDrag.y, y, state.w, state.h);
        changed();
        return;
      }
      if (!drag) return;
      var dx = pos.x - drag.x, dy = y - drag.y;
      if (!panning && dx * dx + dy * dy < CLICK_PX * CLICK_PX) return; // still a click
      panning = true;
      state.view = AstroPreview.pan(state.view, dx, dy, state.w);
      drag = { x: pos.x, y: y };
      changed();
    };
    draw.onMouseRelease = function () {
      if (zoomDrag) { zoomDrag = null; changed(); return; }
      var was = drag, at = was && !panning ? press : null;
      drag = null; press = null; panning = false;
      if (at) { pick(AstroPreview.hitConstellation(state.view, state.sky ? state.sky.constellations : [], at.x, at.y, state.w, state.h)); return; }
      if (was) changed();
    };

    function setWidth(px) {
      px = Math.round(px);
      if (!(px >= 16)) return; // not laid out yet: keep the current size
      px = Math.max(px, MIN_WIDTH);
      var h = Math.round(px * state.comp.h / state.comp.w);
      if (state.sized && Math.abs(px - state.w) < 2) return;
      state.w = px; state.h = h; state.sized = true;
      draw.setSize(px, h);
      // setSize locks the minimum size: re-apply a small minimum width (so the panel can shrink) and the real height.
      if (typeof draw.setMinimumWidth === "function") draw.setMinimumWidth(MIN_WIDTH);
      if (typeof draw.setMinimumHeight === "function") draw.setMinimumHeight(h);
      changed();
    }

    return {
      widget: layout,
      setWidth: setWidth,
      // The comp's real size: the Draw takes its shape, and the green frame and camera outline their aspect.
      setCompSize: function (w, h) {
        if (!(w > 0 && h > 0)) return;
        state.comp = { w: w, h: h };
        state.sized = false;
        setWidth(state.w);
      },
      setView: function (v) {
        state.view = { ra: AstroSky.wrapRa(v.ra), dec: Math.max(-90, Math.min(90, v.dec)), fov: Math.max(5, Math.min(180, v.fov)) };
        changed();
      },
      view: function () { return state.view; },
      setSky: function (data) {
        var theme = data.theme && typeof data.theme === "object" ? data.theme : AstroStyles.find(data.theme || "Realistic", []);
        state.sky = { stars: AstroPreview.starsForPreview(data.stars), constellations: data.constellations };
        state.colours = AstroStyles.previewColors(theme);
        draw.setBackgroundColor(state.colours.background);
        changed();
      },
      setResults: function (list) { state.results = list ? list.slice() : []; changed(); },
      setCurrent: function (cam) { state.current = cam || null; changed(); },
      onPick: function (fn) { state.onPick = typeof fn === "function" ? fn : null; },
      redraw: function () { render(); },
      stats: function () { return state.stats; }
    };
  }

  return { create: create };
})();
