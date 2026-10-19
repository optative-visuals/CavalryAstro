// Constellation reveals: the staging of one Amount % (0..100) into each part's value, the spotlight dim of the
// rest of the sky, the title's place, and the timing of a reveal. Pure, with no dependencies, so it also runs
// inside a Cavalry utility's expression (as ASTRO_REVEAL_SRC, with the sky maths).
var AstroReveal = (function () {
  // Each part's Amount % range: it is 0 before the first value and 1 after the second (smoothstep between).
  var STAGES = { border: [0, 40], lines: [15, 75], labels: [55, 85], title: [75, 100] };
  // The spotlight dims the rest of the sky by the border stage of each reveal.
  var SPOTLIGHT_STAGE = STAGES.border;
  // Share of a flight's length that a reveal takes before the flight ends (spec section 8).
  var FLIGHT_SHARE = 0.4;
  // Title corners, as the panel lists them: 0 top-left, 1 top-centre (default), 2 top-right, 3 bottom-left,
  // 4 bottom-centre, 5 bottom-right. The title sits this many pixels in from the frame's edge.
  var DEFAULT_CORNER = 1;
  var OFF_SCREEN = 1e6;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 0 before range[0], 1 from range[1] on, smoothstep between.
  function stage(amount, range) {
    var t = clamp((amount - range[0]) / (range[1] - range[0]), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // The darkest the rest of the sky gets: the largest spotlight of any reveal, scaled by its border stage.
  // reveals: [{amount, spotlight}]. Returns 0..100.
  function spotlightDim(reveals) {
    var dim = 0;
    for (var i = 0; i < reveals.length; i++) {
      var r = reveals[i];
      dim = Math.max(dim, r.spotlight * stage(r.amount, SPOTLIGHT_STAGE));
    }
    return dim;
  }

  // Where the title goes, in Cavalry pixels with the origin at the comp centre and y up.
  // mode 0 (Header): a corner of the frame, inset by margin. mode 1 (Follows constellation): the projected centre
  // of the constellation, moved offsetY up. projected is [x, y], or null when the centre is not on screen.
  function titlePosition(mode, corner, margin, compW, compH, projected, offsetY) {
    if (mode === 1) {
      if (!projected) return [OFF_SCREEN, OFF_SCREEN];
      return [projected[0], projected[1] + offsetY];
    }
    var halfW = compW / 2 - margin, halfH = compH / 2 - margin;
    var place = [[-halfW, halfH], [0, halfH], [halfW, halfH], [-halfW, -halfH], [0, -halfH], [halfW, -halfH]];
    var c = place[corner] ? corner : DEFAULT_CORNER;
    return [place[c][0], place[c][1]];
  }

  // When a reveal starts and how many frames it takes. If the last flight went to this constellation, the reveal
  // starts 40% of the way into that flight and ends with it. Otherwise it starts at the playhead and lasts compFps
  // frames (one second).
  function revealTiming(lastFlight, conIndex, playhead, compFps) {
    var t = lastFlight && lastFlight.target;
    if (t && t.kind === "constellation" && t.index === conIndex) {
      var start = Math.round(lastFlight.end - FLIGHT_SHARE * (lastFlight.end - lastFlight.start));
      return { start: start, frames: lastFlight.end - start };
    }
    return { start: playhead, frames: compFps };
  }

  return {
    STAGES: STAGES,
    stage: stage,
    spotlightDim: spotlightDim,
    titlePosition: titlePosition,
    revealTiming: revealTiming
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroReveal;
