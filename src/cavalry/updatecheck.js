// Update check: once a day a detached curl asks GitHub for the latest release, and a timer
// waits for its reply, so opening the panel never waits on the network. The answer is kept in
// settings.json (latestVersion, updateCheckedAt), so the reminder shows on every panel open
// until the user updates, without asking GitHub again. Any failure stays silent.
// "checkForUpdates": false in settings.json switches it off.
var AstroUpdateCheck = (function () {
  var TICK_MS = 1000, MAX_TICKS = 30;
  function replyFile() { return AstroAttrs.ASSETS_DIR() + "/cache/downloads/latest-release.json"; }

  function Callbacks(tick) { this.onTimeout = tick; }

  // tell(message) shows a notice. Returns the timer waiting for GitHub, or null.
  function run(tell) {
    var settings = AstroNet.loadSettings(), now = Date.now();
    if (settings.checkForUpdates === false) return null;
    var shown = AstroUpdate.notice(settings.latestVersion, ASTRO_VERSION);
    if (shown) tell(shown);
    if (!AstroUpdate.parts(ASTRO_VERSION) || !AstroUpdate.due(settings, now) || !AstroNet.curlAvailable()) return null;
    settings.updateCheckedAt = now; // a failed check isn't retried until tomorrow either
    AstroNet.saveSettings(settings);
    var out = replyFile();
    AstroNet.startDownloadJson(AstroUpdate.API_URL, out);
    var ticks = 0, timer = new api.Timer(new Callbacks(function () {
      try {
        // The file appears while curl is still writing it; only a whole reply parses.
        var latest = api.filePathExists(out) ? AstroUpdate.versionFromRelease(api.readFromFile(out)) : null;
        if (!latest && ++ticks < MAX_TICKS) return;
        timer.stop();
        AstroNet.discard(out);
        if (!latest) return;
        var s = AstroNet.loadSettings();
        s.latestVersion = latest;
        AstroNet.saveSettings(s);
        var msg = AstroUpdate.notice(latest, ASTRO_VERSION);
        if (msg && msg !== shown) tell(msg);
      } catch (e) { timer.stop(); }
    }));
    timer.setRepeating(true);
    timer.setInterval(TICK_MS);
    timer.start();
    return timer;
  }

  return { run: run, MAX_TICKS: MAX_TICKS };
})();
