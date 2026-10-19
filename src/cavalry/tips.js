// Every hover tooltip in one table, so the wording is edited in one place. Keys are stable ids like
// "sky.latitude"; AstroStyle.tip puts the text on a widget. Plain sentences, no markup, and never a less-than
// sign (Cavalry may read tooltips as rich text). Keys are grouped by the panel part they belong to (sky., settings.).
var AstroTips = (function () {
  var TEXTS = {
    "sky.picker": "The sky to work on: a sky in this composition, or New sky to make one.",
    "sky.refreshSkies": "Looks for the skies in this composition again.",
    "sky.name": "The name for a new sky. Blank gives Sky 1, Sky 2 and so on.",
    "sky.createHere": "Makes a sky at the preview's green frame, with stars and constellation lines on.",
    "sky.refreshControls": "Brings the sky's Controls up to date and removes any reveal that is broken.",
    "sky.search": "Finds constellations and named stars by name, Latin name or abbreviation. Press Enter or Search.",
    "sky.results": "The search results. Whole sky goes back to the whole sky; pick a result to centre the preview on it.",
    "sky.jump": "Moves the camera to the green frame at once, with no keys.",
    "sky.fly": "Flies the camera to the green frame from Start to End, with a key on each frame.",
    "sky.flyFrom": "The first frame of the flight. Opens on the playhead.",
    "sky.flyTo": "The last frame of the flight. Opens 100 frames after Start.",
    "sky.easing": "How the flight speeds up and slows down.",
    "sky.zoomOut": "How far the camera pulls back on the way.",
    "sky.updateFlight": "Redoes the flight under the playhead with the new Easing and Zoom-out.",
    "sky.driftMove": "The small move for Drift: push in, pull out or pan.",
    "sky.drift": "Moves the camera a little from where it is at Start, over Start to End.",
    "sky.theme": "The theme to apply to the sky, or to use for the next new sky.",
    "sky.applyTheme": "Applies the picked theme to the sky. Colours that are keyed or connected are left alone.",
    "sky.styleName": "The name for a new theme saved from this sky.",
    "sky.saveStyle": "Saves this sky's colours as a theme in the Sky styles folder.",
    "sky.refreshStyles": "Reads the Sky styles folder again, so a theme dropped into it joins the list.",
    "sky.deleteStyle": "Deletes the saved theme picked in the list. Built-in themes can't be deleted.",
    "sky.tipsGotIt": "Hides the Start here box. Show tips again in the settings brings it back.",
    "settings.cog": "Opens the settings.",
    "settings.openStyles": "Opens the Sky styles folder in Explorer or Finder.",
    "settings.exportStyle": "Saves a copy of the theme picked in the Sky tab's list to a file you choose.",
    "settings.updateCheck": "Checks GitHub once a day for a newer version. Switch it off to stop the checks.",
    "settings.showTips": "Brings back the Start here box on the Sky tab.",
    "settings.reset": "Puts easing, zoom-out, drift move and the default theme back to their defaults. Saved themes are kept.",
    "settings.getUpdates": "Opens the CavalryAstro download page."
  };
  function text(key) {
    if (!Object.prototype.hasOwnProperty.call(TEXTS, key)) throw new Error("No tooltip for " + key);
    return TEXTS[key];
  }
  function keys() { return Object.keys(TEXTS); }
  return { text: text, keys: keys };
})();
