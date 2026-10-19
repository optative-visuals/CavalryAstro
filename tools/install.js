// Copies dist/ into Cavalry's user Scripts folder.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, copyDirSync } = require("./buildlib.js");

if (!process.env.APPDATA) throw new Error("APPDATA is not set; this installer targets Windows.");
const scripts = path.join(process.env.APPDATA, "Cavalry", "Scripts");
if (!fs.existsSync(scripts)) throw new Error("Cavalry Scripts folder not found: " + scripts);
fs.copyFileSync(path.join(ROOT, "dist", "CavalryAstro.js"), path.join(scripts, "CavalryAstro.js"));
// The whole assets folder, so nothing new in it has to be listed here.
copyDirSync(path.join(ROOT, "dist", "CavalryAstro_assets"), path.join(scripts, "CavalryAstro_assets"));
console.log("Installed to " + scripts);
