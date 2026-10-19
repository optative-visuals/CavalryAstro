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

  return { USER_AGENT: USER_AGENT, ensureDir: ensureDir, settingsDir: settingsDir, loadSettings: loadSettings, saveSettings: saveSettings,
    updateSettings: updateSettings, removeSettings: removeSettings, curlAvailable: curlAvailable, discard: discard, startDownloadJson: startDownloadJson };
})();
