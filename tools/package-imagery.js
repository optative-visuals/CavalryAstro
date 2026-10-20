// Zips the imagery tiles (tiles/nasa-dsm/**, made by tools/make-sky-tiles.py) into dist/CavalryAstro-imagery-v<version>.zip,
// under CavalryAstro_assets/imagery/nasa-dsm/, with a short IMAGERY-README.txt on how to merge it into the Scripts folder.
// The tiles are never committed (tiles/ is git-ignored). Run: npm run package-imagery.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./buildlib.js");
const { createZip } = require("./ziplib.js");

const PREFIX = "CavalryAstro_assets/imagery/nasa-dsm/";
const NASA_DIR = path.join(ROOT, "tiles", "nasa-dsm");

function imageryReadme(version) {
  return [
    "CavalryAstro imagery v" + version,
    "",
    "The NASA Deep Star Maps photo for CavalryAstro's sky imagery. It needs the CavalryAstro plugin too:",
    "drag the CavalryAstro_plugin folder from the main CavalryAstro download into the Cavalry window once.",
    "",
    "1. In Cavalry, choose Help > Show Scripts Folder.",
    "2. Drag the CavalryAstro_assets folder from this zip into that folder.",
    "   It already has a CavalryAstro_assets folder? Merge into it (on a Mac, hold Option while dragging and choose Merge).",
    "3. Open a sky in the CavalryAstro panel, go to the Imagery tab and press Build imagery.",
    "",
    "Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio (public domain).",
    "Gaia DR2: ESA/Gaia/DPAC.",
    "Add attribution on the Imagery tab puts the credit on the sky.",
    ""
  ].join("\r\n");
}

// Every file under dir, as zip entries with forward-slash names under prefix (sorted, so the zip is the same each time).
function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) collect(full, name + "/", out);
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

// The zip's entries: the README, then every tile under nasa-dsm/ with the imagery path prefix.
function imageryFiles(nasaDir, version) {
  if (!fs.existsSync(nasaDir)) throw new Error("No imagery tiles at " + nasaDir + ". Make them first with tools/make-sky-tiles.py.");
  const tiles = collect(nasaDir, PREFIX, []);
  if (!tiles.length) throw new Error("No imagery tiles in " + nasaDir + ". Make them first with tools/make-sky-tiles.py.");
  return [{ name: "IMAGERY-README.txt", data: Buffer.from(imageryReadme(version), "utf8") }, ...tiles];
}

// Writes the imagery zip into distDir and returns its path.
function writeImageryZip(nasaDir, distDir, version) {
  const files = imageryFiles(nasaDir, version);
  const zipPath = path.join(distDir, "CavalryAstro-imagery-v" + version + ".zip");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(zipPath, createZip(files));
  return zipPath;
}

if (require.main === module) {
  const version = require(path.join(ROOT, "package.json")).version;
  const zipPath = writeImageryZip(NASA_DIR, path.join(ROOT, "dist"), version);
  console.log("Packaged the imagery pack -> " + zipPath + " (" + (fs.statSync(zipPath).size / 1e6).toFixed(1) + " MB)");
} else {
  module.exports = { imageryFiles, writeImageryZip, imageryReadme, PREFIX };
}
