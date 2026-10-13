"""Vygeneruje ikony aplikace do public/ (favicon, ikony pro plochu telefonu a instalaci).

Použití:  python scripts/make-icons.py
Kresba odpovídá logu v aplikaci: modro-zelený čtverec, bílá obrazovka s fajfkou.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
C1 = (43, 87, 255)    # #2b57ff
C2 = (18, 184, 134)   # #12b886
WHITE = (255, 255, 255, 255)
SS = 4                # supersampling pro hladké hrany

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b57ff"/>
      <stop offset="1" stop-color="#12b886"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="13" y="15" width="38" height="27" rx="4.5"/>
    <path d="M24 28.5l5.5 5.5L40.5 23"/>
    <path d="M32 42v5"/>
  </g>
  <rect x="22" y="46" width="20" height="4.5" rx="2.25" fill="#fff"/>
</svg>
"""


def gradient(size):
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3)) + (255,)
    return img


def draw_icon(size, rounded=True, scale=1.0):
    """Vykreslí ikonu. scale < 1 zmenší kresbu (bezpečná zóna pro 'maskable' ikonu)."""
    S = size * SS
    u = S / 64  # jednotka = 1/64 plátna (stejné souřadnice jako SVG)
    bg = gradient(S)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=14 * u if rounded else 0, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    c = 32 * u
    k = u * scale
    P = lambda x, y: (c + (x - 32) * k, c + (y - 32) * k)
    w = round(4.5 * k)

    # obrazovka
    x0, y0 = P(13, 15); x1, y1 = P(51, 42)
    d.rounded_rectangle([x0, y0, x1, y1], radius=4.5 * k, outline=WHITE, width=w)
    # fajfka
    pts = [P(24, 28.5), P(29.5, 34), P(40.5, 23)]
    d.line(pts, fill=WHITE, width=w, joint="curve")
    for pt in (pts[0], pts[-1]):
        d.ellipse([pt[0] - w / 2, pt[1] - w / 2, pt[0] + w / 2, pt[1] + w / 2], fill=WHITE)
    # stojan a podstavec
    a = P(32, 42); b = P(32, 47)
    d.line([a, b], fill=WHITE, width=w)
    bx0, by0 = P(22, 46); bx1, by1 = P(42, 50.5)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=2.25 * k, fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    (OUT / "favicon.svg").write_text(SVG, encoding="utf-8")
    draw_icon(32).save(OUT / "favicon-32.png")
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512).save(OUT / "icon-512.png")
    # Android: celoplošné pozadí, kresba v bezpečné zóně
    draw_icon(512, rounded=False, scale=0.78).save(OUT / "icon-maskable-512.png")
    # iOS: bez průhlednosti, rohy zaobluje systém sám
    draw_icon(180, rounded=False, scale=0.86).convert("RGB").save(OUT / "apple-touch-icon.png")
    # klasický favicon.ico pro starší prohlížeče
    big = draw_icon(256)
    big.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("Ikony vytvořeny v", OUT)


if __name__ == "__main__":
    main()
