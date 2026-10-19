// Hashing and formatting.
var AstroUtil = (function () {
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hash(str) { return fnv1a(str) + fnv1a(str + "#"); }

  function formatBytes(n) { return Math.round(n / 1e3) < 1000 ? Math.round(n / 1e3) + " KB" : (n / 1e6).toFixed(1) + " MB"; }

  return { hash: hash, formatBytes: formatBytes };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AstroUtil;
