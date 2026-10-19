# CavalryAstro

**Night-sky motion design inside [Cavalry](https://cavalry.studio/)**: a star field, constellation
lines and names, and reveals that draw each constellation on in turn. It works as a sister to
[Cavalry Geo](https://github.com/optative-visuals/CavalryGeo), and every sky is made of ordinary
Cavalry layers you can style, keyframe and render.

[![Latest release](https://img.shields.io/github/v/release/optative-visuals/CavalryAstro?label=download)](https://github.com/optative-visuals/CavalryAstro/releases/latest)
[![Licence: GPL v3](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)
[![Support my work on Ko-fi](https://img.shields.io/badge/support%20my%20work-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/optative)

Work in progress. v0.1 covers the sky, the constellations and the reveals. See the
[guide](docs/guide.md#known-limits) for what is still to come.

## Quick start

1. **Make a sky.** On the **Sky** tab, pick **New sky**, optionally name it, and press **Create sky here**.
2. **Find a constellation.** Type its name in **Search** (for example Orion) and press **Search**, then pick it.
3. **Fly here.** Set **From** and **To** (the first and last frame of the flight) and press **Fly here**.
4. **Reveal.** On the **Reveal** tab, pick one or more constellations and press **Reveal selected**.

Every sky's settings sit in its **Sky controls** and **Reveal controls** components in the Scene Window.

## Install

1. Download the latest **CavalryAstro** zip from the
   [Releases page](https://github.com/optative-visuals/CavalryAstro/releases/latest) and unzip it.
2. In Cavalry, choose **Help → Show Scripts Folder**, and drag **CavalryAstro.js** and the
   **CavalryAstro_assets** folder straight into it.
3. Open **Scripts → CavalryAstro**. No restart needed.

Updating? Replace CavalryAstro.js, and merge the new CavalryAstro_assets folder into the old one (on a
Mac, hold Option while dragging and choose Merge). Your settings and saved styles are kept elsewhere,
in Cavalry's app-data folder, so an update never touches them.

Tested with Cavalry on Windows and macOS.

## Guide

The [guide](docs/guide.md) covers each tab, the Controls, the themes and the settings.

## Credits

- [Cavalry Geo](https://github.com/optative-visuals/CavalryGeo) by optative-visuals, the sister project
  this plugin was seeded from: its build tooling, panel kit, settings and style code.
- Star data: [HYG Database](https://github.com/astronexus/HYG-Database) by astronexus, CC BY-SA 4.0.
- Constellation lines, borders and names: [d3-celestial](https://github.com/ofrohn/d3-celestial),
  BSD-3-Clause.

The full attributions, the d3-celestial licence text and the changes made to the HYG data are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Licence

CavalryAstro is free software under the GNU General Public License, version 3 or (at your option) any
later version (GPL-3.0-or-later). See [LICENSE](LICENSE). The bundled star data keeps its own
licence (CC BY-SA 4.0), and the constellation data keeps its own (BSD-3-Clause); see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
