"""Home-page preview cards: six hand-picked pictures per category as small
4:3 WebP thumbnails in assets/thumbs/<category>-<n>.webp (site.js deals them
out when a category is pointed at).

The picks are the most striking picture of each project or page, not simply
the first ones. The last card of each list lies on top of the pile, so put
the strongest picture last. A pick can be (path, crop) to zoom in, the crop
given as fractions of the picture: (left, top, right, bottom). Run from the
repository root after changing them:

    python3 tools/thumbs.py

Needs Pillow.
"""
import os
import sys

from PIL import Image, ImageOps

PICKS = {  # six each, in step with DECK_SIZE in site.js
    "projects": [
        "assets/projects/rocket-sim/code.png",
        "assets/projects/rod-end/cad-iso.jpg",
        "assets/projects/aim174b/model-photo.jpg",
        "assets/projects/vtol/uav-render.png",
        "assets/projects/scissor-lift/sl-06.jpg",
        ("assets/projects/tmr-l/cfd-v3.webp", (0.133, 0.069, 0.836, 0.819)),
    ],
    "drawings": [
        "assets/drawings/dwg-01.jpg",
        "assets/drawings/dwg-06.png",
        "assets/drawings/dwg-09.jpg",
        "assets/projects/tmr-l/ar-desk.webp",
        "assets/projects/tmr-l/v3-flight.webp",
        "assets/projects/tmr-l/cfd-v2-mesh.webp",
    ],
    "aerial": [
        "assets/aerial/aerial-09.jpg",
        "assets/aerial/aerial-16.jpg",
        "assets/aerial/aerial-19.jpg",
        "assets/aerial/aerial-13.jpg",
        "assets/aerial/aerial-17.jpg",
        "assets/aerial/aerial-08.jpg",
    ],
    "certifications": [
        "assets/certs/duke.jpg",
        "assets/certs/hkust.jpg",
        "assets/certs/fig-solidworks.png",
        "assets/certs/fig-math.jpg",
        "assets/certs/fig-oilgas.jpg",
        "assets/certs/fig-quantum.png",
    ],
}
COUNT = 6
SIZE = (480, 360)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "thumbs")


def flat_background(im):
    """The shared corner colour if the picture sits on a plain background
    (logos, drawings, CAD shots), else None (photos)."""
    w, h = im.size
    corners = [im.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    if max(max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3)) > 14:
        return None
    return tuple(sum(c[i] for c in corners) // 4 for i in range(3))


def card(src, crop=None):
    with Image.open(os.path.join(ROOT, src)) as im:
        im = ImageOps.exif_transpose(im).convert("RGBA")
        white = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(white, im).convert("RGB")  # transparent logos on white
        if crop:
            w, h = im.size
            im = im.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
            return ImageOps.fit(im, SIZE, Image.LANCZOS)
        bg = flat_background(im)
        if bg is None:
            return ImageOps.fit(im, SIZE, Image.LANCZOS)
        # Plain background: show the whole picture, padded with that colour.
        im.thumbnail((int(SIZE[0] * 0.86), int(SIZE[1] * 0.86)), Image.LANCZOS)
        out = Image.new("RGB", SIZE, bg)
        out.paste(im, ((SIZE[0] - im.width) // 2, (SIZE[1] - im.height) // 2))
        return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, sources in PICKS.items():
        if len(sources) != COUNT:
            sys.exit(f"{key}: {len(sources)} pictures, need {COUNT}")
        for n, pick in enumerate(sources, 1):
            src, crop = pick if isinstance(pick, tuple) else (pick, None)
            if not os.path.exists(os.path.join(ROOT, src)):
                sys.exit(f"{key}: missing {src}")
            dst = os.path.join(OUT, f"{key}-{n}.webp")
            card(src, crop).save(dst, "WEBP", quality=78, method=6)
            print(f"{key}-{n}.webp  {os.path.getsize(dst) // 1024:>3} KB  <- {src}")


if __name__ == "__main__":
    main()
