// The CavalryAstro panel. A placeholder until the real panel lands: the Sky · Stars · Reveal tab bar, the ⚙
// cog beside it, and an empty page per tab. It runs when the script loads.
var ASTRO_TABS = ["Sky", "Stars", "Reveal"];
var astroTabs = null, astroPages = null, astroStatus = null;

function buildUi() {
  ui.setTitle("CavalryAstro");
  if (typeof ui.setBackgroundColor === "function") ui.setBackgroundColor(AstroStyle.WINDOW_BACKGROUND);
  astroPages = AstroStyle.pageStack(AstroStyle.PAGE_BACKGROUND);
  ASTRO_TABS.forEach(function () { astroPages.add(new ui.VLayout()); });
  astroPages.finish();
  astroTabs = AstroStyle.tabBar(ASTRO_TABS, function (name, i) { astroPages.setPage(i); });
  astroStatus = new ui.Label("");
  var cog = AstroCog.button(function () {
    AstroCog.open(null, cog, function () { astroStatus.setText("Settings come in a later version."); });
  });
  var bar = new ui.HLayout();
  bar.add(astroTabs.widget);
  bar.add(cog);
  var root = new ui.VLayout();
  root.setMargins(4, 4, 4, 4);
  root.add(bar);
  root.add(astroPages.widget);
  if (typeof root.addStretch === "function") root.addStretch();
  root.add(astroStatus);
  ui.add(root);
  ui.show();
}
buildUi();
