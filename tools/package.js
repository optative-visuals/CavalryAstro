// Builds the plugin, then writes dist/CavalryAstro-v<version>.zip for a GitHub release.
// The zip unpacks straight into Cavalry's Scripts folder.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./buildlib.js");
const { createZip } = require("./ziplib.js");

function installText(version) {
  return [
    "CavalryAstro v" + version,
    "",
    "1. In Cavalry, choose Help > Show Scripts Folder.",
    "2. Drag CavalryAstro.js and the CavalryAstro_assets folder into that folder (straight in,",
    "   not inside another folder).",
    "   Updating? Replace CavalryAstro.js, and merge the new CavalryAstro_assets folder into the old one (on a Mac, hold Option while dragging and choose Merge). Your settings are kept elsewhere, in Cavalry's app-data folder, so an update never touches them.",
    "3. Open Scripts > CavalryAstro. No restart needed.",
    "",
    "Star data: HYG Database (CC BY-SA 4.0). Constellation lines and names: d3-celestial (BSD-3-Clause).",
    "CavalryAstro is free software under the GNU GPL v3 or later (see LICENSE.txt); it comes with ABSOLUTELY NO WARRANTY.",
    "Source: https://github.com/optative-visuals/CavalryAstro",
    ""
  ].join("\r\n");
}

function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) collect(full, name + "/", out);
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

function packageFiles(dist, version) {
  return [
    { name: "CavalryAstro.js", data: fs.readFileSync(path.join(dist, "CavalryAstro.js")) },
    ...collect(path.join(dist, "CavalryAstro_assets"), "CavalryAstro_assets/", []),
    { name: "LICENSE.txt", data: fs.readFileSync(path.join(ROOT, "LICENSE.txt")) },
    { name: "README.md", data: fs.readFileSync(path.join(ROOT, "README.md")) },
    { name: "THIRD-PARTY-NOTICES.md", data: fs.readFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.md")) },
    { name: "docs/guide.md", data: fs.readFileSync(path.join(ROOT, "docs", "guide.md")) },
    { name: "INSTALL.txt", data: Buffer.from(installText(version), "utf8") }
  ];
}

if (require.main === module) {
  const version = require(path.join(ROOT, "package.json")).version;
  const dist = path.join(ROOT, "dist");
  execFileSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });
  const files = packageFiles(dist, version);
  const zipPath = path.join(dist, "CavalryAstro-v" + version + ".zip");
  fs.writeFileSync(zipPath, createZip(files));
  console.log("Packaged " + files.length + " files -> " + zipPath + " (" + (fs.statSync(zipPath).size / 1e6).toFixed(1) + " MB)");
} else {
  module.exports = { packageFiles, installText };
}
