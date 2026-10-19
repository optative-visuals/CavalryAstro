// Builds assets/sky/stars.json and assets/sky/constellations.json from the HYG star catalogue and d3-celestial's
// constellation data. Run with `npm run sky-data` (needs network). Downloads stay in memory and are not committed.
//
// Sources (pinned commits):
//   HYG Database v4.1, hyg/CURRENT/hygdata_v41.csv
//     astronexus/HYG-Database @ c7f7f883fe678cc7680169a50ccd7dcc49b060ce. Licence: CC BY-SA 4.0.
//   d3-celestial data: constellations.json, constellations.lines.json, constellations.bounds.json
//     ofrohn/d3-celestial @ 7e720a3de062059d4c5400a379146a601d9010e0. Licence: BSD-3-Clause.
//
// The output format is read by src/core/catalog.js; tests/skydata.test.js checks the committed files.
const fs = require("node:fs");
const path = require("node:path");
const { GREEK } = require("../src/core/catalog.js");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "sky");
const HYG_URL = "https://raw.githubusercontent.com/astronexus/HYG-Database/" +
  "c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT/hygdata_v41.csv";
const D3_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/" +
  "7e720a3de062059d4c5400a379146a601d9010e0/data/";
const MAG_LIMIT = 7.0;
const SNAP_DEG = 0.1;
const DENSIFY_STEP_DEG = 0.8;
const DEG = Math.PI / 180;

function round(x, dp) { const f = Math.pow(10, dp); return Math.round(x * f) / f; }
function wrapRa(lon) { return (lon + 360) % 360; }

// Great-circle separation in degrees (haversine).
function sepDeg(ra1, dec1, ra2, dec2) {
  const dDec = (dec2 - dec1) * DEG, dRa = (ra2 - ra1) * DEG;
  const h = Math.sin(dDec / 2) * Math.sin(dDec / 2) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.sin(dRa / 2) * Math.sin(dRa / 2);
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / DEG;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.text();
}

// Quote-aware CSV line splitter (HYG quotes every field).
function parseCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "Alp" -> "α", "Pi-1" -> "π1". Returns "" for anything that is not a Bayer designation.
function greekBayer(s) {
  const m = /^([A-Za-z]{2,3})(?:-(\d+))?$/.exec(s || ""); // HYG writes Pi, Mu, Nu and Xi with two letters
  if (!m) return "";
  const g = GREEK.find((p) => p[0].toLowerCase() === m[1].toLowerCase());
  return g ? g[1] + (m[2] || "") : "";
}

// Shoelace area of a ring of [ra, dec] points (planar, on unwrapped RA).
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// Unwraps RA so consecutive points take the short way round, then closes the ring.
function unwrapRing(ring) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let ra = ring[i][0];
    const prev = out[i - 1][0];
    while (ra - prev > 180) ra -= 360;
    while (ra - prev < -180) ra += 360;
    out.push([ra, ring[i][1]]);
  }
  return out;
}

// Inserts points so that no edge is longer than DENSIFY_STEP_DEG (checked along the sphere and along each axis),
// interpolating linearly in RA (unwrapped) and Dec. The ring is closed: the last point links back to the first.
function densify(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    // Short way round in RA, so a ring that encloses a pole (Octans) closes without a 360 degree sweep.
    let dRa = b[0] - a[0];
    while (dRa > 180) dRa -= 360;
    while (dRa < -180) dRa += 360;
    const dDec = b[1] - a[1];
    const midDec = (a[1] + b[1]) / 2;
    const span = Math.max(sepDeg(a[0], a[1], b[0], b[1]), Math.abs(dRa) * Math.cos(midDec * DEG), Math.abs(dDec));
    const n = Math.max(1, Math.ceil(span / DENSIFY_STEP_DEG));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + t * dRa, a[1] + t * dDec]);
    }
  }
  return out;
}

// Spherical mean of a ring's points: fallback centre when d3-celestial gives no label position.
function sphericalMean(points) {
  let x = 0, y = 0, z = 0;
  for (const [ra, dec] of points) {
    x += Math.cos(dec * DEG) * Math.cos(ra * DEG);
    y += Math.cos(dec * DEG) * Math.sin(ra * DEG);
    z += Math.sin(dec * DEG);
  }
  return [wrapRa(Math.atan2(y, x) / DEG), Math.atan2(z, Math.hypot(x, y)) / DEG];
}

function buildStars(hygText) {
  const lines = hygText.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const I = (name) => header.indexOf(name);
  const stars = [];
  let unknownBayer = 0, noCi = 0;
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li]) continue;
    const f = parseCsvLine(lines[li]);
    if (f[I("id")] === "0") continue; // the Sun
    const mag = parseFloat(f[I("mag")]);
    if (!isFinite(mag) || mag > MAG_LIMIT) continue;
    const ra = (parseFloat(f[I("ra")]) * 15 + 360) % 360;
    const ci = parseFloat(f[I("ci")]);
    if (!isFinite(ci)) noCi++;
    const bayerRaw = f[I("bayer")];
    const bayer = greekBayer(bayerRaw);
    if (bayerRaw && !bayer) unknownBayer++;
    stars.push({
      ra: round(ra, 4) % 360, dec: round(parseFloat(f[I("dec")]), 4), mag: round(mag, 2),
      bv: isFinite(ci) ? round(ci, 2) : 0.6, conId: f[I("con")], name: f[I("proper")] || "", bayer: bayer
    });
  }
  // Brightest first. Array.prototype.sort is stable, so equal magnitudes keep catalogue order.
  stars.sort((a, b) => a.mag - b.mag);
  return { stars, unknownBayer, noCi };
}

function buildConstellations(d3) {
  const cons = d3.constellations.features, lines = d3.lines.features, bounds = d3.bounds.features;
  const ids = [...new Set(cons.map((f) => f.id))].sort();
  return ids.map((id) => {
    // Serpens has two features (Caput and Cauda) under one id: the first gives the label position and names.
    const feats = cons.filter((f) => f.id === id);
    const p = feats[0].properties;
    const lineCoords = [];
    for (const lf of lines.filter((f) => f.id === id)) {
      for (const line of lf.geometry.coordinates) lineCoords.push(line.map(([lon, lat]) => [wrapRa(lon), lat]));
    }
    // Borders: one closed Polygon per id in constellations.bounds.json. For Serpens, keep the larger part.
    let ring = null, best = -1;
    for (const bf of bounds.filter((f) => f.id === id)) {
      const pts = bf.geometry.coordinates[0].map(([lon, lat]) => [wrapRa(lon), lat]);
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      const unwrapped = unwrapRing(pts);
      const area = ringArea(unwrapped);
      if (area > best) { best = area; ring = unwrapped; }
    }
    const border = densify(ring).map(([ra, dec]) => [round(((ra % 360) + 360) % 360, 4) % 360, round(dec, 4)]);
    const centre = p.display
      ? [round(wrapRa(p.display[0]), 4), round(p.display[1], 4)]
      : sphericalMean(border);
    return { id, name: p.en, latin: p.la, genitive: p.gen, centre, lineCoords, border, parts: feats.length };
  });
}

function main() {
  return Promise.all([
    fetchText(HYG_URL),
    fetchText(D3_URL + "constellations.json"),
    fetchText(D3_URL + "constellations.lines.json"),
    fetchText(D3_URL + "constellations.bounds.json")
  ]).then((texts) => {
    const d3 = {
      constellations: JSON.parse(texts[1]), lines: JSON.parse(texts[2]), bounds: JSON.parse(texts[3])
    };
    const { stars, unknownBayer, noCi } = buildStars(texts[0]);
    const cons = buildConstellations(d3);
    const conIndex = new Map(cons.map((c, i) => [c.id, i]));

    // Snap each line vertex to the nearest star within SNAP_DEG (an exact copy of the star's [ra, dec]).
    // A vertex with no star in range is kept (rounded) and reported, not dropped.
    const unsnapped = [];
    let snapped = 0;
    const starPos = stars.map((s) => [s.ra, s.dec]);
    function nearestStar(ra, dec) {
      let best = -1, bestD = Infinity;
      for (let j = 0; j < starPos.length; j++) {
        if (Math.abs(starPos[j][1] - dec) > SNAP_DEG) continue;
        const d = sepDeg(ra, dec, starPos[j][0], starPos[j][1]);
        if (d < bestD) { bestD = d; best = j; }
      }
      return bestD <= SNAP_DEG ? best : -1;
    }
    for (const c of cons) {
      const rows = new Set();
      c.lines = c.lineCoords.map((line) => line.map(([ra, dec]) => {
        const j = nearestStar(ra, dec);
        if (j < 0) {
          unsnapped.push(c.id + " " + round(ra, 4) + "," + round(dec, 4));
          return [round(ra, 4), round(dec, 4)];
        }
        snapped++;
        rows.add(j);
        return [starPos[j][0], starPos[j][1]];
      }));
      c.stars = [...rows].sort((a, b) => a - b); // row indices, brightest first
    }

    const starRows = stars.map((s) => [s.ra, s.dec, s.mag, s.bv,
      conIndex.has(s.conId) ? conIndex.get(s.conId) : -1, s.name, s.bayer]);
    const starsJson = '{"v":1,"cols":["ra","dec","mag","bv","con","name","bayer"],"rows":[\n' +
      starRows.map((r) => JSON.stringify(r)).join(",\n") + "\n]}\n";
    const consJson = '{"v":1,"list":[\n' + cons.map((c) => JSON.stringify({
      id: c.id, name: c.name, latin: c.latin, genitive: c.genitive, centre: c.centre,
      lines: c.lines, border: c.border, stars: c.stars
    })).map((s) => "  " + s).join(",\n") + "\n]}\n";

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "stars.json"), starsJson);
    fs.writeFileSync(path.join(OUT_DIR, "constellations.json"), consJson);

    const serpens = cons.find((c) => c.id === "Ser");
    console.log("Stars kept (mag <= " + MAG_LIMIT + "): " + stars.length + ", unknown Bayer labels: " + unknownBayer +
      ", stars without B-V (set to 0.6): " + noCi);
    console.log("Constellations: " + cons.length + ". Serpens features merged: " + serpens.parts +
      " (border = larger part)");
    console.log("Line vertices snapped: " + snapped + ", unsnapped: " + unsnapped.length +
      (unsnapped.length ? " " + unsnapped.join("; ") : ""));
    console.log("Wrote " + path.join(OUT_DIR, "stars.json") + " (" + starsJson.length + " bytes)");
    console.log("Wrote " + path.join(OUT_DIR, "constellations.json") + " (" + consJson.length + " bytes)");
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
