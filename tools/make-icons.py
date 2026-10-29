"""Generate PWA icons (navy tile, orange water drop, white wave). Pure PIL, drawn at 4x and downsampled."""
import sys, os
from PIL import Image, ImageDraw

NAVY, ORANGE, WHITE = (11, 42, 74), (242, 107, 29), (255, 255, 255)

def bez(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out

def icon(size, maskable=False):
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=NAVY)
        r = S * 0.30          # keep the mark inside the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=NAVY)
        r = S * 0.36
    cx = cy = S / 2
    m = lambda x, y: (cx + x * r, cy + y * r)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    ring = r * 0.88
    d.ellipse([cx - ring, cy - ring, cx + ring, cy + ring], outline=ORANGE, width=max(2, int(r * 0.06)))
    pts = (bez(m(0, -.62), m(.2, -.36), m(.44, -.12), m(.44, .14)) + bez(m(.44, .14), m(.44, .4), m(.24, .58), m(0, .58))
           + bez(m(0, .58), m(-.24, .58), m(-.44, .4), m(-.44, .14)) + bez(m(-.44, .14), m(-.44, -.12), m(-.2, -.36), m(0, -.62)))
    d.polygon(pts, fill=ORANGE)
    wave = bez(m(-.3, .2), m(-.16, .08), m(-.06, .3), m(.08, .18)) + bez(m(.08, .18), m(.17, .11), m(.24, .14), m(.3, .2))
    d.line(wave, fill=NAVY, width=max(2, int(r * 0.08)), joint='curve')
    for x, y in (wave[0], wave[-1]):
        w = r * 0.04; d.ellipse([x - w, y - w, x + w, y + w], fill=NAVY)
    return img.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for name, size, mk in (('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True), ('apple-touch-180.png', 180, False), ('favicon-32.png', 32, False)):
    icon(size, mk).save(os.path.join(out, name), optimize=True)
print('ok')
