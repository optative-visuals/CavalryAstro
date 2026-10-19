// Sky theme files: each saved theme is one JSON file in the "Sky styles" folder, so a theme can be
// shared, backed up or moved between machines. Pure: the panel does the reading, writing and
// folder work; this module only turns themes into file text and back, and plans what a move keeps.
if (typeof AstroStyles === "undefined" && typeof require !== "undefined") { var AstroStyles = require("./styles.js"); }
var AstroStyleFiles = (function () {
  var MARKER = "cavalryAstroStyle", FOLDER = "Sky styles";

  // A safe file name for a theme: characters Windows and macOS refuse become "-", and a Windows
  // device name (CON, COM1...) gets a dash so it is never taken for a device.
  function fileName(name) {
    var base = String(name == null ? "" : name).trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/, "");
    base = base.replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\s*(\.|$))/i, "$1-");
    return (base || "Style") + ".json";
  }

  function toText(theme) {
    var out = {}, key;
    out[MARKER] = 1;
    for (key in theme) if (Object.prototype.hasOwnProperty.call(theme, key)) out[key] = theme[key];
    return JSON.stringify(out, null, 2);
  }

  // Null unless the text is a theme file (marker and name present) that is not a built-in.
  function fromText(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || obj[MARKER] !== 1) return null;
    if (typeof obj.name !== "string" || !obj.name.trim()) return null;
    var theme = AstroStyles.normalise(obj);
    return theme && !AstroStyles.isBuiltIn(theme.name) ? theme : null;
  }

  // entries: [{ path, text }] in folder order. The first of each name wins; the rest are skipped.
  // paths maps each kept theme's lowercased name to its file, so a save or delete finds the file.
  // skipped lists the skipped paths; reasons says why ("not-style" or "duplicate"); names maps each path
  // that holds a theme to that theme's name, so a note can name a duplicate.
  function readAll(entries) {
    var styles = [], skipped = [], paths = {}, reasons = {}, names = {}, seen = {};
    (entries || []).forEach(function (e) {
      var s = fromText(e.text), k = s ? s.name.toLowerCase() : null;
      if (!s) { skipped.push(e.path); reasons[e.path] = "not-style"; return; }
      names[e.path] = s.name;
      if (seen[k]) { skipped.push(e.path); reasons[e.path] = "duplicate"; return; }
      seen[k] = true;
      paths[k] = e.path;
      styles.push(s);
    });
    return { styles: styles, skipped: skipped, paths: paths, reasons: reasons, names: names };
  }

  // The themes a move carries over from a settings object: normalised, built-in names and duplicates left out.
  function movePlan(settings) {
    var list = settings && Array.isArray(settings.themes) ? settings.themes : [], out = [], seen = {};
    list.forEach(function (e) {
      var t = AstroStyles.normalise(e), k = t ? t.name.toLowerCase() : null;
      if (!t || AstroStyles.isBuiltIn(t.name) || seen[k]) return;
      seen[k] = true;
      out.push(t);
    });
    return out;
  }

  return { MARKER: MARKER, FOLDER: FOLDER, fileName: fileName, toText: toText, fromText: fromText, readAll: readAll, movePlan: movePlan };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroStyleFiles;
