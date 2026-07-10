"""
把 26 个字母的离线合成（幽灵底图 + markers）拼成一张联系表，
一眼核对所有字母的点划是否落在字形上。输出 /tmp/verify_all.png
"""
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GHOST_DIR = ROOT / "frontend" / "public" / "letter-glyph"
GLYPH_JS = ROOT / "frontend" / "src" / "letterGlyphs.js"
ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def load_glyphs():
    txt = GLYPH_JS.read_text(encoding="utf-8")
    m = re.search(r"=\s*(\{.*\});\s*$", txt, re.S)
    return json.loads(m.group(1))


def render_cell(letter, glyphs, cell=200):
    g = glyphs[letter]
    ghost = Image.open(GHOST_DIR / f"{letter}.png").convert("RGBA")
    W, H = ghost.size
    vb = g["viewBox"].split()
    vbw = float(vb[2]); vbh = float(vb[3])
    sx = W / vbw; sy = H / vbh
    bg = Image.new("RGBA", (W, H), (18, 18, 22, 255))
    bg.alpha_composite(ghost)
    d = ImageDraw.Draw(bg)
    for mk in g["markers"]:
        if mk["type"] == "dot":
            cx = mk["cx"] * sx; cy = mk["cy"] * sy
            r = mk.get("r", 4.4) * sx
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(246, 217, 138, 255))
        else:
            pts = mk.get("pts")
            thick = int(round(mk.get("thick", 7) * sx))
            if pts and len(pts) >= 2:
                xy = [(x * sx, y * sy) for x, y in pts]
                d.line(xy, fill=(246, 217, 138, 255), width=max(thick, 3), joint="curve")
            else:
                half = min(mk.get("len", 20), 34) / 2
                rad = math.radians(mk.get("angle", 0))
                ux, uy = math.cos(rad), math.sin(rad)
                x1 = (mk["cx"] - ux * half) * sx; y1 = (mk["cy"] - uy * half) * sy
                x2 = (mk["cx"] + ux * half) * sx; y2 = (mk["cy"] + uy * half) * sy
                d.line([(x1, y1), (x2, y2)], fill=(246, 217, 138, 255), width=max(thick, 3))
    # 缩到 cell 见方
    scale = cell / max(W, H)
    im = bg.convert("RGB").resize((int(W * scale), int(H * scale)))
    # label
    dd = ImageDraw.Draw(im)
    dd.text((6, 4), f"{letter} {g['morse']}", fill=(255, 220, 120))
    return im


def main():
    glyphs = load_glyphs()
    cell = 200
    cols = 6
    rows = math.ceil(len(ALPHABET) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * cell), (8, 8, 10))
    for i, L in enumerate(ALPHABET):
        im = render_cell(L, glyphs, cell)
        r, c = divmod(i, cols)
        x = c * cell + (cell - im.width) // 2
        y = r * cell + (cell - im.height) // 2
        sheet.paste(im, (x, y))
    out = Path("/tmp/verify_all.png")
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
