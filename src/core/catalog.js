// Sky catalogue: decodes the bundled star and constellation data, searches it, and looks up constellations.
// Data format: assets/sky/stars.json and assets/sky/constellations.json (written by tools/build-sky-data.js).
var AstroCatalog = (function () {
  // Bayer abbreviations (as in the HYG catalogue) and their Greek letters, in alphabet order.
  var GREEK = [["Alp", "α"], ["Bet", "β"], ["Gam", "γ"], ["Del", "δ"], ["Eps", "ε"], ["Zet", "ζ"], ["Eta", "η"],
    ["The", "θ"], ["Iot", "ι"], ["Kap", "κ"], ["Lam", "λ"], ["Mu", "μ"], ["Nu", "ν"], ["Xi", "ξ"], ["Omi", "ο"],
    ["Pi", "π"], ["Rho", "ρ"], ["Sig", "σ"], ["Tau", "τ"], ["Ups", "υ"], ["Phi", "φ"], ["Chi", "χ"], ["Psi", "ψ"],
    ["Ome", "ω"]];

  var WORD_SPLIT = /[\s\-'’.,()\/]+/;
  var DEG = Math.PI / 180;

  // Lower case, accents removed, trimmed, so that search and lookup ignore case and diacritics.
  function normalise(s) {
    s = String(s == null ? "" : s);
    if (typeof s.normalize === "function") s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.toLowerCase().replace(/^\s+|\s+$/g, "");
  }

  function decodeStars(json) {
    var rows = json.rows, n = rows.length;
    var F = typeof Float64Array !== "undefined" ? Float64Array : Array;
    var out = { ra: new F(n), dec: new F(n), mag: new F(n), bv: new F(n), con: new Array(n), name: new Array(n),
      bayer: new Array(n), count: n };
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      out.ra[i] = r[0]; out.dec[i] = r[1]; out.mag[i] = r[2]; out.bv[i] = r[3];
      out.con[i] = r[4]; out.name[i] = r[5] || ""; out.bayer[i] = r[6] || "";
    }
    return out;
  }

  function decodeConstellations(json) {
    return json.list.map(function (c) {
      return { id: c.id, name: c.name, latin: c.latin, genitive: c.genitive, centre: c.centre,
        lines: c.lines, border: c.border, stars: c.stars };
    });
  }

  // 2 = exact match on one of the fields, 1 = a word of one of them starts with q, 0 = no match.
  function matchFields(fields, q) {
    var best = 0;
    for (var k = 0; k < fields.length; k++) {
      var f = normalise(fields[k]);
      if (!f) continue;
      if (f === q) return 2;
      if (f.indexOf(q) === 0) { best = 1; continue; }
      var words = f.split(WORD_SPLIT);
      for (var w = 0; w < words.length; w++) if (words[w].indexOf(q) === 0) { best = 1; break; }
    }
    return best;
  }

  function search(query, cons, stars, limit) {
    limit = limit || 20;
    var q = normalise(query);
    if (!q) return [];
    var exactCons = [], prefixCons = [], exactStars = [], prefixStars = [];
    var i, j;
    for (i = 0; i < cons.length; i++) {
      var c = cons[i];
      var m = matchFields([c.name, c.latin, c.genitive, c.id], q);
      if (!m) continue;
      var hit = { kind: "constellation", index: i, label: c.name, ra: c.centre[0], dec: c.centre[1] };
      (m === 2 ? exactCons : prefixCons).push(hit);
    }
    for (j = 0; j < stars.count; j++) {
      var name = stars.name[j], bayer = stars.bayer[j];
      if (!name && !bayer) continue;
      var conId = stars.con[j] >= 0 && cons[stars.con[j]] ? cons[stars.con[j]].id : "";
      var label = name || (bayer + (conId ? " " + conId : ""));
      var sm = matchFields([name, bayer && conId ? bayer + " " + conId : bayer], q);
      if (!sm) continue;
      var sh = { kind: "star", index: j, label: label, ra: stars.ra[j], dec: stars.dec[j] };
      (sm === 2 ? exactStars : prefixStars).push(sh);
    }
    return exactCons.concat(exactStars, prefixCons, prefixStars).slice(0, limit);
  }

  function findConstellation(cons, idOrName) {
    var q = normalise(idOrName);
    if (!q) return -1;
    for (var i = 0; i < cons.length; i++) {
      var c = cons[i];
      if (normalise(c.id) === q || normalise(c.name) === q || normalise(c.latin) === q ||
          normalise(c.genitive) === q) return i;
    }
    return -1;
  }

  // Stereographic projection about a constellation's centre: a tangent-plane projection that never wraps RA.
  // Returns [u, v], or null at the antipode of the centre.
  function project(centre, ra, dec) {
    var a = centre[0] * DEG, d = centre[1] * DEG;
    var ea = [-Math.sin(a), Math.cos(a), 0];
    var na = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
    var p = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
    var r = ra * DEG, e = dec * DEG, ce = Math.cos(e);
    var x = [ce * Math.cos(r), ce * Math.sin(r), Math.sin(e)];
    var dp = 1 + x[0] * p[0] + x[1] * p[1] + x[2] * p[2];
    if (dp < 1e-9) return null;
    return [2 * (x[0] * ea[0] + x[1] * ea[1] + x[2] * ea[2]) / dp,
      2 * (x[0] * na[0] + x[1] * na[1] + x[2] * na[2]) / dp];
  }

  // The constellation's border rings, projected about its centre (cached on the object).
  function projectedRings(c) {
    if (!c._projected) {
      var rings = [];
      for (var r = 0; r < c.border.length; r++) {
        var ring = [];
        for (var i = 0; i < c.border[r].length; i++) {
          var p = project(c.centre, c.border[r][i][0], c.border[r][i][1]);
          if (p) ring.push(p);
        }
        rings.push(ring);
      }
      c._projected = rings;
    }
    return c._projected;
  }

  function inRing(ring, x, y) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Index of the constellation whose border (any of its rings) contains the point, or -1.
  function constellationAt(cons, ra, dec) {
    for (var i = 0; i < cons.length; i++) {
      var p = project(cons[i].centre, ra, dec);
      if (!p) continue;
      var rings = projectedRings(cons[i]);
      for (var r = 0; r < rings.length; r++) if (inRing(rings[r], p[0], p[1])) return i;
    }
    return -1;
  }

  return {
    GREEK: GREEK,
    normalise: normalise,
    decodeStars: decodeStars,
    decodeConstellations: decodeConstellations,
    search: search,
    findConstellation: findConstellation,
    constellationAt: constellationAt
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroCatalog;
