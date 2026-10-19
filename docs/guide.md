# CavalryAstro guide

Everything the panel does, section by section. New here? Start with the
[quick start](../README.md#quick-start) in the README.

The panel's sections, **Sky**, **Stars**, **Reveal** and **Imagery**, are tabs along the top. The **⚙** button at the
right end of that row opens **Settings**. Each section's controls sit in shaded panels. Hover any control
for a short tip about what it does.

- [Sky](#sky)
- [Stars](#stars)
- [Reveal](#reveal)
- [Imagery](#imagery)
- [Controls](#controls)
- [Styles](#styles)
- [Settings (⚙)](#settings-)
- [Known limits](#known-limits)

## Sky

A sky is a group in your composition with a **Camera** layer. The background, the stars, the constellation
lines, borders and names all follow that camera. Everything you make on the Sky tab goes into the sky you
pick.

The first time you open the panel, a **Start here** box at the top of the tab gives four quick steps. Press
**Got it** to hide it. **Show tips again** (in **⚙ Settings → Preferences**) brings it back.

- **Making a sky:** with **New sky** picked in the sky list (the only entry in a composition with no skies),
  optionally type a name, and press **Create sky here**. The sky is made at the green frame in the preview,
  with stars and constellation lines on. A blank name gives **Sky 1**, **Sky 2** and so on. The name field
  only shows while **New sky** is picked.
- **Refresh:** looks for the skies in this composition again. Use it if a sky you expect is missing.
- **Refresh controls:** brings the sky's Controls up to date, and removes any reveal that has broken (one
  whose amount was deleted by hand).
- **Finding a constellation:** type a name in **Search**, for example Orion, and press **Search** or Enter.
  You can search by name, Latin name or abbreviation, and find named stars too. Pick a result from the
  list to centre the preview on it. **Whole sky** goes back to the whole sky.
- **The preview:** the picture under the search results. Drag it to move. The green frame shows exactly
  where the camera will go, and **Jump here**, **Fly here** and **Create sky here** all use that frame.
- **Jump here:** moves the camera to the green frame straight away, with no keys.
- **Fly here:** flies the camera from the green frame in **From** to the green frame in **To**. The
  camera gets a key on each frame of the flight. **From** and **To** are frame numbers. They open on the
  playhead and 100 frames later, and then move on after each flight, so the next flight starts where the
  last one ended.
  - **Easing** sets how the flight speeds up and slows down: **Smooth**, **Gentle**, **Snappy** or
    **Overshoot**.
  - **Zoom-out** sets how far the camera pulls back on the way: **Low**, **Normal** or **High**.
  - **Update flight** redoes the flight under the playhead with the new **Easing** and **Zoom-out**.
  - If a flight ends after the end of your composition, Cavalry asks before it extends the composition
    by three seconds.
- **Drift:** moves the camera a little from where it is at **From** over the frames to **To**, without a
  target. Pick a **Drift move** first: **Push in**, **Pull out**, **Pan left**, **Pan right**, **Pan up** or
  **Pan down**.

## Stars

These controls change the picked sky's stars and whole-sky ticks.

- **Sky darkness:** a slider from **City** (few stars) to **Countryside** (the most). It sets how faint a
  star can be before it is left out. City shows stars down to magnitude 3, and Countryside down to
  magnitude 7.
- **Star colours:** on shows each star in its true colour. Off draws them all in the theme's one star colour.
- **Glow:** a soft glow around the brightest stars.
- **Star size:** how big the stars are drawn. The glow scales with them.
- **All constellation lines**, **All borders** and **All names:** show or hide those parts across the whole
  sky.

## Reveal

A reveal draws one constellation on over a set number of frames. Its lines draw on, its border lights up,
its title appears and its brightest stars can be labelled.

- **Find:** narrows the **Constellations** list by name. Leave it blank to list all 88, from A to Z. Press
  Enter or **Find**.
- **Constellations:** pick one or more. Constellations are named by their Latin names, as astronomers use
  them, for example **Canis Major** and **Ursa Major**. The first one you pick sets **Start** and
  **Frames** to suit the last flight.
- **Lines draw on**, **Border lights up**, **Title** and **Star labels:** switch each part on or off.
- **Title style:** **Header** puts the title in a corner of the frame. **Follows constellation** puts it
  over the constellation.
- **Start:** the first frame of the reveal. It opens on the last flight's reveal point, or the playhead.
- **Frames:** how many frames each reveal takes. It opens on the flight's length, or one second.
- **Reveal selected:** makes one reveal for each picked constellation. They run one after another from
  **Start**, and each starts where the last one ends.
- **Change reveal:** rebuilds the reveal you have selected in the Scene Window, with the ticks and title style
  you have set here. Select the reveal's group, or a layer inside it, first.

Each reveal is a group named for its number and constellation, for example **Reveal 1: Orion**, inside its
sky. Its settings are in the sky's **Reveal controls** (see [Controls](#controls)).

## Imagery

Imagery puts a photograph of the sky behind the drawn stars: NASA's Deep Star Maps, bent onto your camera so
its stars line up with the drawn ones. The photo is read from files on your computer, so nothing is
downloaded while you work.

It needs two things, set up once:

1. **The plugin.** Drag the **CavalryAstro_plugin** folder from the download into the Cavalry window. It adds
   the **CavalryAstro Reproject** filter that bends the photo.
2. **The imagery pack.** Download the **CavalryAstro-imagery** zip from the
   [Releases page](https://github.com/optative-visuals/CavalryAstro/releases/latest), unzip it, and merge its
   **CavalryAstro_assets** folder into the one in your Scripts folder (Help → Show Scripts Folder). On a Mac,
   hold Option while dragging and choose Merge.

Then, on the **Imagery** tab:

- **Build imagery:** with a sky picked, press **Build imagery**. Cavalry asks first, with how many tiles the
  flight needs, then builds them in steps under the progress bar. A tile missing from the pack is skipped and
  counted in the status line. Press **Cancel** to stop: the part-built photo is taken down, and any older photo
  stays as it was.
- **Rebuilding:** after you change the flight, press **Build imagery** again. The new photo replaces the old
  one, and the Opacity and Brightness you set are kept.
- **Layer order:** the photo sits above the drawn stars and below the constellation lines, borders, names and
  reveals. To put the drawn stars over the photo, drag the photo's group, **Imagery: NASA Deep Star Maps**,
  below the star layers in the Scene Window. The panel never moves it back.
- **Controls:** once the photo exists, the sky's **Sky controls** hold three rows after **Background**:
  **Imagery · Opacity** (0 to 100), **Imagery · Hide**, and **Imagery · Brightness** (0 to 4, the filter's gain).
- **Add attribution:** puts the credit **NASA/Goddard SVS · Gaia DR2: ESA/Gaia/DPAC** in the bottom left of the
  sky. Press it again and there is still one credit. NASA's images are public domain, but please keep the credit.

Sky darkness and styles don't change the photo; they change only the drawn stars and lines. A reveal's
Spotlight dims the photo evenly, as it dims the sky.

## Controls

Each sky gets two components in the Scene Window: **<sky name> Sky controls**, and, once the sky has
reveals, **<sky name> Reveal controls**. They hold the settings you tweak without going back to the panel.
Change a value and the sky updates straight away.

- **Sky controls** holds the camera (**Centre RA**, **Centre Dec**, **Field of view**, **Rotation**), the
  stars (**Sky darkness**, **Size** and **Glow**), the **Background** colour, the photo's **Imagery · Opacity**,
  **Hide** and **Brightness** (once the photo exists), and each line set's **Hide**, **Colour** and **Width**. The names have their own **Hide**, **Colour** and **Size**.
- **Reveal controls** holds each reveal in its own block, numbered to match its group. Each block has
  **Amount %**, **Spotlight**, the lines' colour and width, the border colour and, when the title is shown,
  its mode, corner and size. Labels have a size too.

If a sky's Controls fall out of date, press **Refresh controls** on the Sky tab to bring them up to date.

## Styles

A style is a theme: the colours and widths a sky uses. The built-in themes are **Realistic**, **Mono**,
**Blueprint**, **Vintage chart** and **Neon**. **Realistic** is the default.

- **Style** (on the Sky tab) and **Apply to sky:** the style picker holds the built-in and saved styles. Press
  **Apply to sky** to give the picked sky the picked style's colours. Colours that you have keyed or
  connected in Cavalry are left alone. The picked style is also the one a new sky uses, so pick it before
  you press **Create sky here**.
- **Save as style:** saves the picked sky's current colours as a new theme. Type a name for it first, in
  **Name for a new style**. The theme is saved as a file in the **Sky styles** folder.
- **Refresh:** reads the **Sky styles** folder again, so a theme you have dropped into it joins the list.
- **Delete style:** removes a saved theme. Built-in themes can't be deleted.

Saved themes are plain files, one per theme, so you can share one by copying its file. **Open styles
folder** and **Export style…** in **⚙ Settings → Sky styles** help with that.

## Settings (⚙)

The **⚙** button opens the settings, a popover under the button. Press outside it to close it.

- **Sky styles:** **Open styles folder** opens the folder where your saved themes are kept, and
  **Export style…** saves a copy of the theme picked on the Sky tab to a file you choose.
- **Preferences:** **Check for updates** is on by default. It checks GitHub once a day for a newer
  version and shows the result in the status line. Switch it off to stop the checks. **Show tips again**
  brings back the **Start here** box. **Reset remembered choices** puts easing, zoom-out, drift move and
  the default theme back to their defaults. It asks first, and saved themes are kept.
- **About:** the version, and **Get updates…**, which opens the download page.

## Known limits

- **One imagery source.** The **Imagery** tab offers NASA Deep Star Maps only, and it needs the plugin and the
  imagery pack (see [Imagery](#imagery)).
- **No place and time in v0.1.** The sky is not yet set for a place on Earth or a time. That comes in
  v0.3.
- **No Moon or planets in v0.1.** They come in v0.4.
- **No astronomy facts in v0.1.** Facts about the constellations and stars come in v0.5.
- **Star data goes to magnitude 7.** That is the faintest star the sky can show, even at Countryside.
- **Saved styles need Cavalry's file access.** The panel reads and writes the **Sky styles** folder. If your
  Cavalry can't list or write folders, saving, deleting and reading saved themes won't work. The built-in
  themes still do. There is no settings fallback yet.
- **Installing by hand.** To install, copy the files into Cavalry's Scripts folder as described in the
  [README](../README.md#install). The installer script in the source is for developers on Windows only.
