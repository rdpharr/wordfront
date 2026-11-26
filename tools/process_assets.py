"""Turn the raw ChatGPT art and music in assets/incoming into game-ready files
in public/assets.

- Sprites: alpha cleaned (near-opaque -> opaque), cropped to their content,
  resized to 2x their on-screen size (crisp on high-DPI screens), saved as WebP.
- Ground tile: top/bottom seam cross-faded so it scrolls without a visible join;
  a water-only tile is cut from its sides for the area outside the road.
- Title art, logo, icons resized.
- Music transcoded to Ogg Opus (smaller, decodes gaplessly for looping).

- Soldiers: if per-soldier art exists (A3_soldier_up_1..5 / A4_soldier_left_1..5),
  each squad member gets their own pair of sprites.

Needs Pillow and ffmpeg on PATH:
    python tools/process_assets.py
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "incoming"
OUT = ROOT / "public" / "assets"

# name -> (source file, output height in px at 2x; or width when "w" given)
SPRITES = {
    "barricade": ("A2_barricade.png", {"w": 520}),
    "soldier_up": ("A3_soldier_up.png", {"h": 112}),
    "soldier_left": ("A4_soldier_left.png", {"h": 112}),
    "shambler": ("A5_shambler.png", {"h": 128}),
    "bomber": ("A6_bomber.png", {"h": 156}),
    "boss": ("A7_boss.png", {"h": 280}),
    "firebomb": ("A8_firebomb.png", {"h": 76}),
    "acid": ("A9_acid_glob.png", {"h": 52}),
    "poof": ("A10_poof.png", {"h": 180}),
    "airstrike_icon": ("A11_airstrike_icon.png", {"h": 64}),
    "logo": ("A13_logo.png", {"w": 960}),
}


def clean_alpha(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v >= 248 else (0 if v <= 6 else v))
    im.putalpha(a)
    return im


def fit(im: Image.Image, spec: dict) -> Image.Image:
    if "w" in spec:
        w = spec["w"]
        h = round(im.height * w / im.width)
    else:
        h = spec["h"]
        w = round(im.width * h / im.height)
    return im.resize((w, h), Image.Resampling.LANCZOS)


def sprite(name: str, file: str, spec: dict, meta: dict) -> None:
    im = clean_alpha(Image.open(SRC / file))
    box = im.getchannel("A").getbbox()
    if box:
        pad = 6
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
        im = im.crop(box)
    im = fit(im, spec)
    im.save(OUT / f"{name}.webp", "WEBP", quality=90, method=6)
    meta[name] = {"w": im.width, "h": im.height}


def ground(meta: dict) -> None:
    t = Image.open(SRC / "A1_ground_tile.png").convert("RGB")
    w, h = t.size
    # cross-fade the bottom band into the top band so the tile repeats seamlessly
    band = 48
    top = t.crop((0, 0, w, band))
    bottom = t.crop((0, h - band, w, h))
    for i in range(band):
        a = (i + 1) / (band + 1)  # 0 at the seam -> 1 inside
        row_top = top.crop((0, i, w, i + 1))
        row_seam = bottom.crop((0, i, w, i + 1))
        # top rows lean toward the bottom rows near the seam
        mixed = Image.blend(row_seam, row_top, 0.5 + 0.5 * a)
        t.paste(mixed, (0, i))
    t.save(OUT / "ground.webp", "WEBP", quality=88, method=6)

    # road edges (kerb outer edge): water columns have a low average red channel
    red = t.getchannel("R").resize((w, 1), Image.Resampling.BOX)
    is_water = [red.getpixel((x, 0)) < 110 for x in range(w)]
    left = next(x for x in range(w) if not is_water[x])
    right = next(x for x in range(w - 1, -1, -1) if not is_water[x])
    meta["ground"] = {"w": w, "h": h, "roadLeft": left, "roadRight": right}

    # water-only tile from the left band, mirrored so it tiles sideways
    strip = t.crop((0, 0, max(32, left - 8), h))
    water = Image.new("RGB", (strip.width * 2, h))
    water.paste(strip, (0, 0))
    water.paste(strip.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (strip.width, 0))
    water.save(OUT / "water.webp", "WEBP", quality=85, method=6)
    meta["water"] = {"w": water.width, "h": water.height}


def title_art(meta: dict) -> None:
    im = Image.open(SRC / "A0_style_reference.png").convert("RGB")
    im = im.resize((720, 1080), Image.Resampling.LANCZOS)
    im.save(OUT / "title.webp", "WEBP", quality=85, method=6)
    meta["title"] = {"w": im.width, "h": im.height}


def icons() -> None:
    im = Image.open(SRC / "A12_app_icon.png").convert("RGBA")
    icon_dir = ROOT / "assets" / "icon"
    icon_dir.mkdir(parents=True, exist_ok=True)
    im.save(icon_dir / "app-icon-1024.png")  # source for the desktop build's icons (M7)
    im.resize((192, 192), Image.Resampling.LANCZOS).save(ROOT / "public" / "icon-192.png")
    im.resize((32, 32), Image.Resampling.LANCZOS).save(ROOT / "public" / "favicon.png")


def music(meta: dict) -> None:
    for src, name in (("M1_gameplay_loop.mp3", "music_game"), ("M2_title_theme.mp3", "music_title")):
        dst = OUT / f"{name}.ogg"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(SRC / src), "-c:a", "libopus", "-b:a", "112k", str(dst)],
            check=True,
        )
        dur = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(SRC / src)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        meta[name] = {"duration": float(dur)}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta: dict = {}
    for name, (file, spec) in SPRITES.items():
        sprite(name, file, spec, meta)
    # one distinct soldier per squad slot, when that art has been made
    soldiers = []
    for i in range(1, 6):
        up, left = SRC / f"A3_soldier_up_{i}.png", SRC / f"A4_soldier_left_{i}.png"
        if up.exists() and left.exists():
            sprite(f"soldier_up_{i}", up.name, {"h": 112}, meta)
            sprite(f"soldier_left_{i}", left.name, {"h": 112}, meta)
            soldiers.append(i)
    meta["soldiers"] = soldiers
    ground(meta)
    title_art(meta)
    icons()
    music(meta)
    (OUT / "manifest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.iterdir())
    print(json.dumps(meta, indent=1))
    print(f"wrote {len(list(OUT.iterdir()))} files, {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
