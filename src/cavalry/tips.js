// Every hover tooltip in one table, so the wording is edited in one place. Keys are stable ids like
// "sky.latitude"; AstroStyle.tip puts the text on a widget. Plain sentences, no markup, and never a less-than
// sign (Cavalry may read tooltips as rich text). The table starts empty and fills as the panel gets its tooltips.
var AstroTips = (function () {
  var TEXTS = {};
  function text(key) {
    if (!Object.prototype.hasOwnProperty.call(TEXTS, key)) throw new Error("No tooltip for " + key);
    return TEXTS[key];
  }
  function keys() { return Object.keys(TEXTS); }
  return { text: text, keys: keys };
})();
