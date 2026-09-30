#!/usr/bin/env python3
"""Regenerates installer/linux/icons/cdrca-<size>.png from the one real CDRCA
logo (cli/src/templates/assets/cdrca-logo.png).

The logo is 495x491 (not square), so it is centre-cropped to a square first,
then scaled. Commit the outputs; run this only when the logo changes:

    python3 installer/linux/make-icons.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "cli" / "src" / "templates" / "assets" / "cdrca-logo.png"
OUT = Path(__file__).resolve().parent / "icons"
SIZES = (48, 64, 128, 256)

img = Image.open(SRC).convert("RGB")
side = min(img.size)
left = (img.width - side) // 2
top = (img.height - side) // 2
square = img.crop((left, top, left + side, top + side))

OUT.mkdir(exist_ok=True)
for size in SIZES:
    square.resize((size, size), Image.LANCZOS).save(OUT / f"cdrca-{size}.png", optimize=True)
    print(f"wrote {OUT / f'cdrca-{size}.png'}")
