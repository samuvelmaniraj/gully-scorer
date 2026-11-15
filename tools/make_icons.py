#!/usr/bin/env python3
"""Draw the home-screen icons (stumps and a ball on turf green) with Pillow.

Usage:  python3 tools/make_icons.py
Writes icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png
to the repo root. Run again only if the design changes.
"""
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
TURF, CREAM, BALL, SEAM, SHADOW = "#1F6B45", "#F4F1E4", "#B3261E", "#F7E9E7", "#174F33"
N = 1024  # draw large, then scale down for smooth edges


def art(d, scale, cx, cy):
    """Stumps with bails and a ball, centred on (cx, cy); scale 1.0 fills ~70% of the canvas."""
    s = lambda v: int(v * scale)
    # three stumps
    w, h, gap, top = s(62), s(470), s(118), cy - s(255)
    for i in (-1, 0, 1):
        x = cx + i * gap
        d.rounded_rectangle([x - w // 2, top, x + w // 2, top + h], radius=w // 2, fill=CREAM)
    # two bails resting on top
    bh = s(34)
    for x0, x1 in ((cx - gap - w // 2, cx - s(6)), (cx + s(6), cx + gap + w // 2)):
        d.rounded_rectangle([x0, top - bh - s(10), x1, top - s(10)], radius=bh // 2, fill=CREAM)
    # ball in front, lower right, with a soft shadow ring so it reads against the stumps
    r, bx, by = s(150), cx + s(150), cy + s(140)
    d.ellipse([bx - r - s(18), by - r - s(18), bx + r + s(18), by + r + s(18)], fill=TURF)
    d.ellipse([bx - r, by - r, bx + r, by + r], fill=BALL)
    # curved seam with stitches
    d.arc([bx - r * 2.1, by - r * 1.15, bx + r * 0.25, by + r * 1.15], start=-38, end=38, fill=SEAM, width=s(16))
    for a, b in ((-28, -18), (-8, 2), (12, 22)):
        d.arc([bx - r * 2.3, by - r * 1.3, bx + r * 0.42, by + r * 1.3], start=a, end=b, fill=SEAM, width=s(10))
        d.arc([bx - r * 1.9, by - r * 1.0, bx + r * 0.08, by + r * 1.0], start=a, end=b, fill=SEAM, width=s(10))


def icon(rounded, scale):
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=TURF)
    else:
        d.rectangle([0, 0, N, N], fill=TURF)
    # a crease line across the bottom
    d.rectangle([int(N * 0.18), int(N * 0.79), int(N * 0.82), int(N * 0.80)], fill=SHADOW)
    art(d, scale, N // 2, int(N * 0.52))
    return im


def save(im, name, size, opaque=False):
    out = im.resize((size, size), Image.LANCZOS)
    if opaque:
        bg = Image.new("RGB", out.size, TURF)
        bg.paste(out, mask=out.split()[3])
        out = bg
    out.save(ROOT / name, optimize=True)
    print(f"wrote {name}: {(ROOT / name).stat().st_size} bytes")


plain = icon(rounded=True, scale=1.0)
save(plain, "icon-192.png", 192)
save(plain, "icon-512.png", 512)
# maskable: full-bleed background, art kept inside the central safe circle
save(icon(rounded=False, scale=0.78), "icon-maskable-512.png", 512, opaque=True)
# iOS rounds the corners itself and wants no transparency
save(icon(rounded=False, scale=0.9), "apple-touch-icon.png", 180, opaque=True)
