#!/usr/bin/env python3
"""
Generate a QR code for the Area Code website with the company logo in the centre.

Usage:
    python generate-qr-with-logo.py \
        --url https://www.areacode.co.za/ \
        --logo ../../brand/areacode-logo.png \
        --out ../../brand/areacode-qr.png

Notes:
- Uses error-correction level H (~30% recovery) so the centre logo does not
  break scannability.
- The logo is scaled to ~22% of the QR width and given a small rounded
  padding so it reads cleanly against the modules.
"""

import argparse
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw


def rounded_panel(size: int, radius: int, fill) -> Image.Image:
    panel = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=fill)
    return panel


def main() -> None:
    parser = argparse.ArgumentParser(description="QR code with centred logo")
    parser.add_argument("--url", default="https://www.areacode.co.za/")
    parser.add_argument("--logo", required=True, help="Path to logo image (PNG)")
    parser.add_argument("--out", default="areacode-qr.png")
    parser.add_argument("--box-size", type=int, default=20, help="Pixels per QR module")
    parser.add_argument("--border", type=int, default=4, help="Quiet-zone modules")
    parser.add_argument("--logo-ratio", type=float, default=0.22,
                        help="Logo width as a fraction of the QR width")
    parser.add_argument("--fg", default="#0B0F14", help="Module (dark) colour")
    parser.add_argument("--bg", default="#FFFFFF", help="Background colour")
    parser.add_argument("--panel", default="#000000",
                        help="Colour of the rounded panel behind the logo")
    args = parser.parse_args()

    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=args.box_size,
        border=args.border,
    )
    qr.add_data(args.url)
    qr.make(fit=True)

    img = qr.make_image(fill_color=args.fg, back_color=args.bg).convert("RGBA")
    qr_w, qr_h = img.size

    # Centre logo block
    logo = Image.open(args.logo).convert("RGBA")
    target = int(qr_w * args.logo_ratio)

    # Rounded panel behind the logo for clean separation from the modules.
    pad = max(8, target // 10)
    panel_size = target + pad * 2
    panel = rounded_panel(panel_size, radius=panel_size // 6, fill=args.panel)

    # Scale logo preserving aspect ratio to fit within `target`.
    logo.thumbnail((target, target), Image.LANCZOS)
    lw, lh = logo.size
    panel.paste(logo, ((panel_size - lw) // 2, (panel_size - lh) // 2), logo)

    pos = ((qr_w - panel_size) // 2, (qr_h - panel_size) // 2)
    img.alpha_composite(panel, pos)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    img.convert("RGB").save(args.out, "PNG")
    print(f"Wrote {args.out} ({qr_w}x{qr_h}px) encoding {args.url!r}")


if __name__ == "__main__":
    main()
