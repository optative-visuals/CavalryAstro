// Settings, and the one network call the update check makes. Panel-only: uses `api`.
// Settings live in <app data>/CavalryAstro/settings.json, outside the Scripts folder, so replacing
// CavalryAstro_assets when updating never wipes them.
var AstroNet = (function () {
  var USER_AGENT = "CavalryAstro/" + (typeof ASTRO_VERSION !== "undefined" ? ASTRO_VERSION : "dev") + " (https://github.com/optative-visuals/CavalryAstro)";

  function ensureDir(dir) {
    var parts = dir.split("/"), cur = parts[0];
    for (var i = 1; i < parts.length; i++) {
      cur += "/" + parts[i];
      if (!api.filePathExists(cur)) api.makeFolder(cur);
    }
  }

  function settingsDir() { return String(api.getAppDataFolder()).replace(/\\/g, "/") + "/CavalryAstro"; }
  function settingsFile() { return settingsDir() + "/settings.json"; }
  function plainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function readSettingsRaw() {
    var f = settingsFile();
    if (!api.filePathExists(f)) return null;
    try { return String(api.readFromFile(f)); } catch (e) { return null; }
  }
  function parseSettings(raw) {
    try { var v = JSON.parse(raw); return plainObject(v) ? v : null; } catch (e) { return null; }
  }
  function loadSettings() {
    var raw = readSettingsRaw();
    return (raw === null ? null : parseSettings(raw)) || {};
  }
  function saveSettings(obj) { ensureDir(settingsDir()); api.writeToFile(settingsFile(), JSON.stringify(obj, null, 2), true); }
  // The settings to change and save back: an unreadable file is copied to .bak and starts again.
  function editableSettings() {
    var raw = readSettingsRaw(), s = raw === null ? {} : parseSettings(raw);
    if (!s) {
      s = {};
      if (raw !== null && raw !== "") { try { ensureDir(settingsDir()); api.writeToFile(settingsFile() + ".bak", raw, true); } catch (e) { /* the copy is a courtesy */ } }
    }
    return s;
  }
  // Merges patch's keys into settings.json, keeping every other key.
  function updateSettings(patch) {
    var s = editableSettings();
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    saveSettings(s);
    return s;
  }
  // Deletes the given keys from settings.json, keeping every other key.
  function removeSettings(keys) {
    var s = editableSettings();
    (keys || []).forEach(function (k) { delete s[k]; });
    saveSettings(s);
    return s;
  }

  // True when this Cavalry can run curl (any version, from `curl --version`).
  var curlOk = null;
  function curlAvailable() {
    if (curlOk !== null) return curlOk;
    curlOk = false;
    if (typeof api.runDetachedProcess !== "function" || typeof api.runProcess !== "function") return curlOk;
    try {
      var r = api.runProcess("curl", ["--version"]);
      curlOk = /curl \d+\./.test(typeof r === "string" ? r : JSON.stringify(r));
    } catch (e) { curlOk = false; }
    return curlOk;
  }
  function discard(path) {
    if (path && typeof api.deleteFilePath === "function" && api.filePathExists(path)) { try { api.deleteFilePath(path); } catch (e) { /* harmless leftover */ } }
  }
  // Starts a detached curl that writes the GitHub API reply for url to the file out. The caller polls
  // that file; the reply only parses once curl has finished writing it.
  function startDownloadJson(url, out) {
    discard(out);
    ensureDir(out.slice(0, out.lastIndexOf("/")));
    api.runDetachedProcess("curl", ["-s", "-L", "--fail", "--max-time", "20", "-A", USER_AGENT,
      "-H", "Accept: application/vnd.github+json", "-o", out, url]);
  }

  // Opens a folder (or a link) in the file browser. False when this Cavalry can't, or the open fails.
  function openPath(target) {
    if (typeof api.runDetachedProcess !== "function") return false;
    try {
      var t = String(target), isLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(t);
      var windows = /^[A-Za-z]:\//.test(settingsDir());
      if (windows && !isLink) t = t.replace(/\//g, "\\");
      api.runDetachedProcess(windows ? "explorer" : "open", [t]);
      return true;
    } catch (e) { return false; }
  }

  // ---- Sky style files: one JSON file per saved theme in the "Sky styles" folder -------------------
  function stylesDir() { return settingsDir() + "/" + AstroStyleFiles.FOLDER; }
  // Style files need a Cavalry that can list folders.
  function filesSupported() { return typeof api.listDirectoryPaths === "function" || typeof api.listDirectory === "function"; }
  // The entries of a folder listing with forward slashes; a bare name is put in dir.
  function listFiles(dir) {
    var list = typeof api.listDirectoryPaths === "function" ? api.listDirectoryPaths(dir) : api.listDirectory(dir);
    return (list || []).map(function (p) {
      var s = String(p).replace(/\\/g, "/");
      return s.indexOf("/") < 0 ? dir + "/" + s : s;
    });
  }
  // The .json files in the style folder, in path order (the folder is made if it is missing).
  function listStyleFiles() {
    var dir = stylesDir();
    ensureDir(dir);
    return listFiles(dir).filter(function (p) { return /\.json$/i.test(p); }).sort();
  }
  function readText(path) {
    try { return String(api.readFromFile(path)); } catch (e) { return ""; } // unreadable: skipped by readAll
  }
  // Reads the style folder: { styles, skipped, paths, reasons, names } (see AstroStyleFiles.readAll).
  function readStyleFiles() {
    if (!filesSupported()) return AstroStyleFiles.readAll([]);
    return AstroStyleFiles.readAll(listStyleFiles().map(function (p) { return { path: p, text: readText(p) }; }));
  }
  // Writes a theme to its file and returns the path. A theme already in the folder is written over its own file;
  // a new one takes "<name>.json", or "<name> 2.json"... when that name holds another file, so no file is overwritten.
  function writeStyleFile(style) {
    var path = readStyleFiles().paths[style.name.toLowerCase()];
    if (!path) {
      var dir = stylesDir(), base = AstroStyleFiles.fileName(style.name).replace(/\.json$/, ""), n = 1;
      ensureDir(dir);
      path = dir + "/" + base + ".json";
      while (api.filePathExists(path)) { n++; path = dir + "/" + base + " " + n + ".json"; }
    }
    api.writeToFile(path, AstroStyleFiles.toText(style), true);
    if (!api.filePathExists(path)) throw new Error("Couldn't write " + path + ".");
    return path;
  }
  // Deletes every file in the style folder that holds the theme with this name. Throws when this Cavalry can't
  // delete files, or a file is still there afterwards.
  function deleteStyleFile(name) {
    var key = String(name).trim().toLowerCase(), paths = [];
    if (filesSupported()) paths = listStyleFiles().filter(function (p) {
      var s = AstroStyleFiles.fromText(readText(p));
      return !!s && s.name.toLowerCase() === key;
    });
    paths.forEach(function (path) {
      if (typeof api.deleteFilePath !== "function") throw new Error("This Cavalry can't delete files: delete " + path + " by hand.");
      api.deleteFilePath(path);
      if (api.filePathExists(path)) throw new Error("Couldn't delete " + path + ": it may be open elsewhere.");
    });
    return paths.length;
  }

  return { USER_AGENT: USER_AGENT, ensureDir: ensureDir, settingsDir: settingsDir, openPath: openPath, stylesDir: stylesDir,
    filesSupported: filesSupported, readStyleFiles: readStyleFiles, writeStyleFile: writeStyleFile, deleteStyleFile: deleteStyleFile,
    loadSettings: loadSettings, saveSettings: saveSettings,
    updateSettings: updateSettings, removeSettings: removeSettings, curlAvailable: curlAvailable, discard: discard, startDownloadJson: startDownloadJson };
})();
