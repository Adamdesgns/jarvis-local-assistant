"""Draw the JARVIS JUNIOR app icon.

The junior build needs its own icon: on a family PC the two builds sit side by
side in the Start menu, and a child picks by picture, not by name. This draws
the same friendly face the junior window shows on its orb.

    python scripts/make-junior-icon.py

Writes assets/icon-junior.png (512x512) and assets/icon-junior.ico.
Requires Pillow; only needed when the icon changes.
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024                     # Drawn large, downsampled for clean edges.
OUT = Path(__file__).resolve().parent.parent / "assets"

DEEP = (43, 26, 99)
DEEP_2 = (27, 17, 64)
SUN = (255, 198, 92)
SUN_DEEP = (255, 141, 45)
FACE = (30, 16, 62)


def vertical_gradient(size, top, bottom):
    image = Image.new("RGB", (1, size), top)
    pixels = image.load()
    for y in range(size):
        mix = y / max(1, size - 1)
        pixels[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * mix) for i in range(3))
    return image.resize((size, size))


def radial_orb(size, inner, outer):
    """A soft ball: inner colour in the upper left, outer at the rim."""
    orb = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(orb)
    middle = size / 2
    steps = 220
    highlight = (middle * 0.72, middle * 0.68)
    # Lay the rim colour down first: the highlight circles below are offset,
    # so without this the far side of the ball would be left unpainted.
    draw.ellipse([0, 0, size - 1, size - 1], fill=outer + (255,))
    for step in range(steps, 0, -1):
        mix = step / steps
        radius = middle * mix
        colour = tuple(round(inner[i] + (outer[i] - inner[i]) * (mix ** 0.85)) for i in range(3))
        draw.ellipse(
            [highlight[0] - radius, highlight[1] - radius, highlight[0] + radius, highlight[1] + radius],
            fill=colour + (255,),
        )
    # Clip back to a true circle centred in the square.
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    orb.putalpha(mask)
    return orb


def build():
    canvas = vertical_gradient(SIZE, DEEP, DEEP_2).convert("RGBA")

    # Rounded-square mask, so the icon reads as an app tile rather than a blob.
    tile = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(tile).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
    canvas.putalpha(tile)

    orb_size = int(SIZE * 0.66)
    orb = radial_orb(orb_size, SUN, SUN_DEEP)
    offset = (SIZE - orb_size) // 2
    canvas.alpha_composite(orb, (offset, offset))

    draw = ImageDraw.Draw(canvas)
    middle = SIZE / 2
    eye_gap = orb_size * 0.17
    eye_y = middle - orb_size * 0.05
    eye_w = orb_size * 0.075
    eye_h = orb_size * 0.10
    for side in (-1, 1):
        cx = middle + side * eye_gap
        draw.ellipse([cx - eye_w, eye_y - eye_h, cx + eye_w, eye_y + eye_h], fill=FACE + (235,))

    smile_r = orb_size * 0.30
    draw.arc(
        [middle - smile_r, middle - smile_r + orb_size * 0.06,
         middle + smile_r, middle + smile_r + orb_size * 0.06],
        start=25, end=155, fill=FACE + (205,), width=int(orb_size * 0.055),
    )

    OUT.mkdir(parents=True, exist_ok=True)
    icon = canvas.resize((512, 512), Image.LANCZOS)
    icon.save(OUT / "icon-junior.png")
    icon.save(OUT / "icon-junior.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print(f"wrote {OUT / 'icon-junior.png'} and {OUT / 'icon-junior.ico'}")


if __name__ == "__main__":
    build()
