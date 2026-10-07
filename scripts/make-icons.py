#!/usr/bin/env python3
"""Regenerate the extension icons (icons/icon-{16,32,48,128}.png).

Requires Pillow. Run from the repository root:  python3 scripts/make-icons.py
The icon is a green rounded square with a white archive box and a down arrow.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
GREEN = (30, 142, 62, 255)
WHITE = (255, 255, 255, 255)
SCALE = 8  # draw large, then downsample for smooth edges


def draw_icon(size: int) -> Image.Image:
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=GREEN)

    # Archive box (tray) at the bottom.
    m = s * 0.20
    top = s * 0.58
    w = max(1, int(s * 0.075))
    d.line([(m, top), (m, s - m), (s - m, s - m), (s - m, top)], fill=WHITE, width=w, joint="curve")

    # Down arrow.
    cx = s / 2
    d.line([(cx, s * 0.18), (cx, s * 0.62)], fill=WHITE, width=w)
    head = s * 0.17
    d.polygon(
        [(cx - head, s * 0.50), (cx + head, s * 0.50), (cx, s * 0.70)],
        fill=WHITE,
    )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path("icons")
    out.mkdir(exist_ok=True)
    for size in SIZES:
        draw_icon(size).save(out / f"icon-{size}.png")
        print(f"wrote icons/icon-{size}.png")


if __name__ == "__main__":
    main()
