#!/usr/bin/env python3
"""Offline tiler for NASA's Deep Star Maps 2020 (CavalryAstro v0.2, Task 1).

Reads starmap_2020_32k.exr (celestial, plate carree, linear HDR) from
tiles/source/ and writes, all git-ignored:

  tiles/nasa-dsm/L<n>/<row>_<col>.jpg   1024 px RGB JPEG tiles, quality 90
  tiles/nasa-dsm/manifest.json          levels, source hash, orientation, tone
  tiles/samples/*.jpg                   look samples at three tone settings

Convention: row 0 is Dec +90; col 0 starts at RA 0; RA increases with col.

Memory: reads whole channels (one HALF channel at a time, 1.07 GB for the 32k
map), then holds three 8-bit L3 planes (1.6 GB) and the half-float L2/L1/L0
levels (about 0.8 GB). Peak RAM is about 4 GB (estimated from these sizes, not
measured).

Default tone is "vivid" (the user's pick): middle, then min(1, (v * 2.6) ** 0.75).

Usage (from the repo root, with tools/.venv):
  tools/.venv/Scripts/python.exe tools/make-sky-tiles.py --self-test
  tools/.venv/Scripts/python.exe tools/make-sky-tiles.py [--tone middle]
"""
import argparse
import hashlib
import json
import math
import sys
import tempfile
from collections import namedtuple
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE_NAME = "starmap_2020_32k.exr"
SOURCE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_32k.exr"
SOURCE_DEFAULT = ROOT / "tiles" / "source" / SOURCE_NAME
TILES_ROOT = ROOT / "tiles"
TILE = 1024
JPEG_QUALITY = 90
LEVELS = ((0, 4096, 2048), (1, 8192, 4096), (2, 16384, 8192), (3, 32768, 16384))
ANCHORS = {  # name: (RA deg, Dec deg), J2000
    "Sirius": (101.29, -16.72),
    "Betelgeuse": (88.79, 7.41),
    "Vega": (279.23, 38.78),
}
SEARCH_DEG = 0.1
PEAK_PERCENTILE = 99.99

# Tone settings: linear radiance -> 8-bit sRGB. See tone_u8().
# Source values are normalised 0..1 (median ~1.5e-4, p99.9 ~0.076, stars ~1.0).
# Shoulder S: out = 1 - exp(-v / S), then sRGB encoding. Smaller S = brighter.
# Milky Way glow (~0.03) lands near 60-80/255 in "middle"; stars near 235-250.
TONES = {
    "darker": {"black": 0.0, "exposure": 1.0, "shoulder": 0.85},
    "middle": {"black": 0.0, "exposure": 1.0, "shoulder": 0.565},
    "brighter": {"black": 0.0, "exposure": 1.0, "shoulder": 0.385},
    # The user's pick: "middle", then out = min(1, (v * 2.6) ** 0.75) on the
    # sRGB-encoded value v, in float before quantising.
    "vivid": {"black": 0.0, "exposure": 1.0, "shoulder": 0.565, "gain": 2.6, "gamma": 0.75},
}
TILE_TONE = "vivid"
# 99.9th percentile of the source must map to at most this (8-bit). Vivid is
# allowed to reach 255 because its curve lifts the top 0.1% to full scale.
P999_CAP = {name: 250 for name in TONES}
P999_CAP["vivid"] = 255

SAMPLES = (  # name, level, centre RA, centre Dec, width deg, height deg
    ("orion", 3, 83.8, -5.4, 30.0, 30.0),
    ("milkyway", 1, 300.0, 5.0, 90.0, 90.0),
    ("wholesky", 0, 180.0, 0.0, 360.0, 180.0),
)


# ---------------------------------------------------------------- mapping
# An orientation describes how NASA's array differs from the tool convention:
# optional mirror in RA, optional half-turn in RA (RA 0 at the centre rather
# than the edge), optional flip in Dec. Output pixel (x, y) takes its value from
# the source as: x' = (x - shift) mod w; sx = w-1-x' if flip_x else x';
# sy = h-1-y if flip_y else y.
Orientation = namedtuple("Orientation", "flip_x shift_half flip_y")
ORIENTATIONS = [
    Orientation(fx, sh, fy) for fx in (False, True) for sh in (False, True) for fy in (False, True)
]


def shift_for(o, w):
    return w // 2 if o.shift_half else 0


def ra_dec_to_pixel(ra, dec, w, h):
    """Convention pixel (x, y) of a sky position; x grows with RA, y falls with Dec."""
    x = int(math.floor((ra % 360.0) / 360.0 * w)) % w
    y = int(math.floor((90.0 - dec) / 180.0 * h))
    return x, min(max(y, 0), h - 1)


def src_cols(o, cols, w):
    x = (np.asarray(cols) - shift_for(o, w)) % w
    return (w - 1 - x) if o.flip_x else x


def src_rows(o, rows, h):
    rows = np.asarray(rows)
    return (h - 1 - rows) if o.flip_y else rows


def source_index_for(o, x, y, w, h):
    return int(src_cols(o, [x], w)[0]), int(src_rows(o, [y], h)[0])


def to_convention(src, o, rows=None, cols=None):
    """Gather a region of NASA's array into convention order. Full arrays by default."""
    h, w = src.shape
    rows = np.arange(h) if rows is None else np.asarray(rows)
    cols = np.arange(w) if cols is None else np.asarray(cols)
    return src[np.ix_(src_rows(o, rows, h), src_cols(o, cols, w))]


def brightest_pixel(a):
    y, x = np.unravel_index(int(np.argmax(a)), a.shape)
    return int(x), int(y)


def tile_plane(a, tile):
    """Split a 2-D array into {(row, col): tile} keyed by tile index."""
    h, w = a.shape
    return {
        (r, c): a[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile]
        for r in range(h // tile)
        for c in range(w // tile)
    }


# -------------------------------------------------------------- orientation
def detect_orientation(src, samples=10_000_000, seed=0):
    """Pick the orientation under which every anchor star is a bright peak.

    A candidate passes when, for each anchor, the brightest pixel within
    SEARCH_DEG of its position is at least the image's PEAK_PERCENTILE value.
    Returns (orientation, report). Raises if none or more than one passes.
    """
    h, w = src.shape
    flat = src.reshape(-1)
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, flat.size, size=min(samples, flat.size))
    peak = float(np.percentile(flat[pick].astype(np.float32), PEAK_PERCENTILE))
    rx = int(round(SEARCH_DEG / 360.0 * w))
    ry = int(round(SEARCH_DEG / 180.0 * h))
    passing, report = [], []
    for o in ORIENTATIONS:
        scores = {}
        for name, (ra, dec) in ANCHORS.items():
            x, y = ra_dec_to_pixel(ra, dec, w, h)
            sx, sy = source_index_for(o, x, y, w, h)
            cols = np.arange(sx - rx, sx + rx + 1) % w
            rows = np.clip(np.arange(sy - ry, sy + ry + 1), 0, h - 1)
            best = float(src[np.ix_(rows, cols)].max())
            scores[name] = best / peak if peak > 0 else 0.0
        min_score = min(scores.values())
        report.append((o, scores))
        if min_score >= 1.0:
            passing.append((min_score, o))
    if len(passing) != 1:
        lines = "\n".join(
            f"  flip_x={o.flip_x} shift_half={o.shift_half} flip_y={o.flip_y}: "
            + ", ".join(f"{k} {v:.2f}" for k, v in s.items())
            for o, s in report
        )
        raise RuntimeError(
            f"orientation: {len(passing)} candidate mappings satisfy all three anchors (need exactly 1)\n"
            f"peak (p{PEAK_PERCENTILE}) = {peak:.6g}\n{lines}"
        )
    return passing[0][1], report


# ------------------------------------------------------------------ tone
def tone_float(lin, params):
    """Linear radiance -> sRGB-encoded 0..1 (float). Black point, exposure, soft shoulder,
    then an optional gain/gamma curve on the encoded value."""
    a = np.maximum(np.asarray(lin, np.float32) - params["black"], 0.0) * params["exposure"]
    out = 1.0 - np.exp(-a / params["shoulder"])
    enc = np.where(out <= 0.0031308, 12.92 * out, 1.055 * np.power(out, 1 / 2.4) - 0.055)
    if "gain" in params:
        enc = np.minimum(1.0, np.power(enc * params["gain"], params["gamma"]))
    return enc.astype(np.float32)


def tone_u8(lin, params):
    """Tone to 8 bits. The curve is applied in float; quantising is the last step."""
    return np.clip(np.rint(tone_float(lin, params) * 255.0), 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ tiles
def level_table():
    return [
        {"L": L, "w": w, "h": h, "cols": w // TILE, "rows": h // TILE}
        for L, w, h in LEVELS
    ]


def tile_path(root, L, row, col):
    return Path(root) / "nasa-dsm" / f"L{L}" / f"{row}_{col}.jpg"


def write_tile(rgb, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(rgb), "RGB").save(path, "JPEG", quality=JPEG_QUALITY)


# ---------------------------------------------------------------- self-test
def _check(results, name, fn):
    try:
        fn()
        results.append((name, True, ""))
    except Exception as exc:  # noqa: BLE001 - report every failure
        results.append((name, False, f"{type(exc).__name__}: {exc}"))


def t_convention_places_star():
    # A 360x180 map (1 px = 1 deg). The star must land on the convention pixel
    # for RA 88.79, Dec 7.41 after NASA's orientation is undone, within 1 px.
    w, h = 360, 180
    o = Orientation(flip_x=True, shift_half=True, flip_y=False)
    ox, oy = ra_dec_to_pixel(88.79, 7.41, w, h)
    assert (ox, oy) == (88, 82), (ox, oy)
    src = np.zeros((h, w), np.float32)
    sx, sy = source_index_for(o, ox, oy, w, h)
    src[sy, sx] = 1000.0
    conv = to_convention(src, o)
    bx, by = brightest_pixel(conv)
    assert abs(bx - ox) <= 1 and abs(by - oy) <= 1, f"star at {(bx, by)}, want {(ox, oy)}"
    tiles = tile_plane(conv, 64)
    tc, tr = ox // 64, oy // 64
    assert tiles[(tr, tc)][oy % 64, ox % 64] == 1000.0, "star not in expected tile"


def t_orientation_detects_known_mapping():
    # Synthetic NASA-style map: noise background, three stars placed through a
    # known orientation. The detector must recover that orientation.
    w, h = 360, 180
    rng = np.random.default_rng(3)
    truth = Orientation(flip_x=False, shift_half=True, flip_y=True)
    conv = rng.uniform(0.0, 1.0, (h, w)).astype(np.float32)
    for ra, dec in ANCHORS.values():
        ox, oy = ra_dec_to_pixel(ra, dec, w, h)
        conv[oy, ox] = 800.0
    src = np.empty_like(conv)
    # Invert to_convention: place convention pixels back into the source grid.
    src[np.ix_(src_rows(truth, np.arange(h), h), src_cols(truth, np.arange(w), w))] = conv
    found, report = detect_orientation(src)
    assert found == truth, f"found {found}, want {truth}; {report}"


def t_tone_monotonic_and_capped():
    rng = np.random.default_rng(1)
    sky = rng.lognormal(mean=math.log(0.01), sigma=1.2, size=2_000_000).astype(np.float32)
    p999 = float(np.percentile(sky, 99.9))
    ramp = np.linspace(0.0, 50.0, 20001, dtype=np.float32)
    for name, params in TONES.items():
        y = tone_u8(ramp, params)
        assert y.dtype == np.uint8, "not uint8"
        assert np.all(np.diff(y.astype(np.int16)) >= 0), f"{name}: not monotonic"
        cap = int(tone_u8(np.array([p999], np.float32), params)[0])
        assert cap <= P999_CAP[name], f"{name}: 99.9th percentile maps to {cap}"


def t_levels_match_spec():
    want = [
        (0, 4096, 2048, 4, 2),
        (1, 8192, 4096, 8, 4),
        (2, 16384, 8192, 16, 8),
        (3, 32768, 16384, 32, 16),
    ]
    got = [(r["L"], r["w"], r["h"], r["cols"], r["rows"]) for r in level_table()]
    assert got == want, got
    assert TILE == 1024 and JPEG_QUALITY == 90
    p = tile_path(Path("X"), 2, 7, 15)
    assert p.as_posix() == "X/nasa-dsm/L2/7_15.jpg", p.as_posix()


def t_tile_is_rgb_jpeg():
    with tempfile.TemporaryDirectory() as d:
        arr = np.zeros((TILE, TILE, 3), np.uint8)
        arr[..., 0] = 200
        path = Path(d) / "0_0.jpg"
        write_tile(arr, path)
        with Image.open(path) as im:
            assert im.mode == "RGB", im.mode
            assert im.size == (TILE, TILE), im.size


def self_test():
    results = []
    _check(results, "a: convention places a star at RA 88.79 Dec 7.41", t_convention_places_star)
    _check(results, "b: orientation detector recovers a known mapping", t_orientation_detects_known_mapping)
    _check(results, "c: tone is monotonic; 99.9th percentile <= per-tone cap", t_tone_monotonic_and_capped)
    _check(results, "d: level table and tile paths match the spec", t_levels_match_spec)
    _check(results, "e: tiles are RGB JPEG at 1024 px", t_tile_is_rgb_jpeg)
    ok = all(r[1] for r in results)
    for name, passed, msg in results:
        print(f"[{'PASS' if passed else 'FAIL'}] {name}" + (f"  ({msg})" if msg else ""))
    print("SELF-TEST " + ("GREEN" if ok else "RED"))
    return 0 if ok else 1


# ------------------------------------------------------------------ build
def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 22), b""):
            digest.update(block)
    return digest.hexdigest()


def downsample2(src, chunk=1024):
    """Area-average 2x2 blocks, in strips so the float32 working copy stays small."""
    h, w = src.shape
    out = np.empty((h // 2, w // 2), np.float16)
    for r in range(0, h, chunk):
        blk = src[r:r + chunk].astype(np.float32)
        n = blk.shape[0] // 2
        out[r // 2:r // 2 + n] = blk.reshape(n, 2, w // 2, 2).mean(axis=(1, 3))
    return out


def tone_plane(src, o, tone):
    """Convention-ordered 8-bit plane for one channel, built strip by strip."""
    h, w = src.shape
    out = np.empty((h, w), np.uint8)
    for r in range(0, h, TILE):
        rows = np.arange(r, min(r + TILE, h))
        out[rows[0]:rows[-1] + 1] = tone_u8(to_convention(src, o, rows=rows), tone)
    return out


def region(w, h, lon0, lat0, wdeg, hdeg):
    """Convention rows and cols of a sky rectangle (centre RA/Dec, size in degrees)."""
    x0 = int(round(((lon0 - wdeg / 2) % 360.0) / 360.0 * w))
    nx = int(round(wdeg / 360.0 * w))
    y0 = int(round((90.0 - (lat0 + hdeg / 2.0)) / 180.0 * h))
    ny = int(round(hdeg / 180.0 * h))
    cols = np.arange(x0, x0 + nx) % w
    rows = np.clip(np.arange(y0, y0 + ny), 0, h - 1)
    return rows, cols


def check_highlights(sample_flat):
    """The 99.9th percentile of the source must tone-map to at most 250 for every setting."""
    p999 = float(np.percentile(sample_flat, 99.9))
    report = {}
    for name, params in TONES.items():
        cap = int(tone_u8(np.array([p999], np.float32), params)[0])
        report[name] = cap
        if cap > P999_CAP[name]:
            raise RuntimeError(
                f"tone '{name}': source 99.9th percentile ({p999:.4g}) maps to {cap} > {P999_CAP[name]}"
            )
    return p999, report


def build(source, tile_tone):
    import OpenEXR

    source = Path(source)
    if not source.exists():
        print(f"missing source: {source}\nDownload {SOURCE_URL} into tiles/source/ first.")
        return 2
    print(f"source {source} ({source.stat().st_size} bytes)")
    sha = sha256_file(source)
    print(f"sha256 {sha}")

    names = ("R", "G", "B")
    rng = np.random.default_rng(7)
    orientation = None
    orient_report = None
    p999 = None
    cap_report = None
    planes = {3: [], 2: [], 1: [], 0: []}
    small = {2: [], 1: [], 0: []}  # source-orientation linear, per channel
    crops = {}

    for ci, cname in enumerate(names):
        f = OpenEXR.InputFile(str(source))
        try:
            raw = f.channel(cname)  # raw HALF bytes for one channel
        finally:
            f.close()
        S3 = np.frombuffer(raw, dtype=np.float16).reshape(LEVELS[3][2], LEVELS[3][1])
        del raw
        if orientation is None:
            flat = S3.reshape(-1)
            sample = flat[rng.integers(0, flat.size, size=10_000_000)].astype(np.float32)
            p999, cap_report = check_highlights(sample)
            print(f"source p99.9 = {p999:.6g}; tone maps it to {cap_report}")
            orientation, orient_report = detect_orientation(S3)
            print(f"orientation: {orientation}")
            for o, scores in orient_report:
                if o == orientation:
                    print("  anchor peak / image peak:", {k: round(v, 2) for k, v in scores.items()})
        print(f"channel {cname}: tone-mapping L3 strips")
        planes[3].append(tone_plane(S3, orientation, TONES[tile_tone]))
        # Orion crop at L3, from linear data, kept for the samples.
        rows, cols = region(32768, 16384, 83.8, -5.4, 30.0, 30.0)
        crops.setdefault("orion", {})[cname] = to_convention(S3, orientation, rows, cols)
        small[2].append(downsample2(S3))
        del S3
        small[1].append(downsample2(small[2][-1]))
        small[0].append(downsample2(small[1][-1]))
        print(f"channel {cname}: done")

    for L, arrs in ((2, small[2]), (1, small[1]), (0, small[0])):
        for cname, arr in zip(names, arrs):
            planes[L].append(tone_plane(arr, orientation, TONES[tile_tone]))

    # Milky Way and whole-sky crops from the linear downsampled levels.
    for sname, L, lon0, lat0, wdeg, hdeg in SAMPLES[1:]:
        lin_src = small[L]
        rows_c, cols_c = region(LEVELS[L][1], LEVELS[L][2], lon0, lat0, wdeg, hdeg)
        crops[sname] = {
            cname: to_convention(arr, orientation, rows_c, cols_c)
            for cname, arr in zip(names, lin_src)
        }

    out_root = TILES_ROOT
    bytes_per_level = {}
    for L, w, h in LEVELS:
        cols_n, rows_n = w // TILE, h // TILE
        total = 0
        for r in range(rows_n):
            for c in range(cols_n):
                rgb = np.stack(
                    [p[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE] for p in planes[L]],
                    axis=-1,
                )
                path = tile_path(out_root, L, r, c)
                write_tile(rgb, path)
                total += path.stat().st_size
        bytes_per_level[L] = total
        print(f"L{L}: {rows_n * cols_n} tiles, {total / 1e6:.1f} MB")

    sample_dir = out_root / "samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    sample_files = []
    for sname, L, lon0, lat0, wdeg, hdeg in SAMPLES:
        for tname, params in TONES.items():
            rgb = np.stack([tone_u8(crops[sname][c], params) for c in names], axis=-1)
            fname = f"sample_{sname}_L{L}_{tname}.jpg"
            write_tile(rgb, sample_dir / fname)
            sample_files.append(fname)
            print(f"sample {fname} {rgb.shape[1]}x{rgb.shape[0]}")

    manifest = {
        "v": 1,
        "source": "NASA SVS Deep Star Maps 2020 (starmap_2020_32k.exr)",
        "source_url": SOURCE_URL,
        "source_bytes": source.stat().st_size,
        "source_sha256": sha,
        "orientation": {"flip_x": orientation.flip_x, "shift_half": orientation.shift_half, "flip_y": orientation.flip_y},
        "source_p999": p999,
        "levels": [
            {**row, "bytes": bytes_per_level[row["L"]]} for row in level_table()
        ],
        "tile": TILE,
        "jpeg_quality": JPEG_QUALITY,
        "tone": {
            "tiles": tile_tone,
            "chosen": tile_tone,
            "gain": TONES[tile_tone].get("gain"),
            "gamma": TONES[tile_tone].get("gamma"),
            "settings": TONES,
        },
        "samples": sample_files,
    }
    (out_root / "nasa-dsm").mkdir(parents=True, exist_ok=True)
    (out_root / "nasa-dsm" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("manifest written")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks and exit")
    ap.add_argument("--source", type=Path, default=SOURCE_DEFAULT)
    ap.add_argument("--tone", choices=sorted(TONES), default=TILE_TONE, help="tone used for the tiles")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    return build(args.source, args.tone)


if __name__ == "__main__":
    sys.exit(main())
