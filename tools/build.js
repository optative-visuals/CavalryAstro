// Writes dist/CavalryAstro.js and dist/CavalryAstro_assets/ (the sky data and icons, where present).
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, buildPanel, copyAssetIfPresent } = require("./buildlib.js");

const dist = path.join(ROOT, "dist");
const assetsOut = path.join(dist, "CavalryAstro_assets");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(assetsOut, { recursive: true });
fs.writeFileSync(path.join(dist, "CavalryAstro.js"), buildPanel());
copyAssetIfPresent("sky", assetsOut);
copyAssetIfPresent("icons", assetsOut);
console.log("Built " + path.join(dist, "CavalryAstro.js"));
