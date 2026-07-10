"""在每个字母的标记上标注揭示顺序号(1,2,3...)，用于核对书写顺序是否符合直觉。
输出 /tmp/order_all.png（6列联系表）。"""
import json, re, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GHOST_DIR = ROOT / "frontend" / "public" / "letter-glyph"
GLYPH_JS = ROOT / "frontend" / "src" / "letterGlyphs.js"
ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

def load():
    t = GLYPH_JS.read_text(encoding="utf-8")
    return json.loads(re.search(r"=\s*(\{.*\});\s*$", t, re.S).group(1))

try:
    FONT = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 34)
except Exception:
    FONT = ImageFont.load_default()

def render_cell(letter, glyphs, cell=220):
    g = glyphs[letter]
    ghost = Image.open(GHOST_DIR / f"{letter}.png").convert("RGBA")
    W, H = ghost.size
    vb = g["viewBox"].split(); vbw = float(vb[2]); vbh = float(vb[3])
    sx = W / vbw; sy = H / vbh
    bg = Image.new("RGBA", (W, H), (18, 18, 22, 255))
    bg.alpha_composite(ghost)
    d = ImageDraw.Draw(bg)
    centers = []
    for mk in g["markers"]:
        if mk["type"] == "dot":
            cx = mk["cx"] * sx; cy = mk["cy"] * sy; r = mk.get("r", 4.4) * sx
            d.ellipse([cx-r,cy-r,cx+r,cy+r], fill=(246,217,138,255))
            centers.append((cx, cy))
        else:
            pts = mk.get("pts"); thick = int(round(mk.get("thick",7)*sx))
            xy = [(x*sx, y*sy) for x,y in pts]
            d.line(xy, fill=(246,217,138,255), width=max(thick,3), joint="curve")
            centers.append((mk["cx"]*sx, mk["cy"]*sy))
    # 顺序号
    for i,(cx,cy) in enumerate(centers):
        txt = str(i+1)
        d.ellipse([cx-15,cy-15,cx+15,cy+15], fill=(20,20,28,235), outline=(255,90,90,255), width=2)
        tb = d.textbbox((0,0), txt, font=FONT)
        d.text((cx-(tb[2]-tb[0])/2, cy-(tb[3]-tb[1])/2-tb[1]), txt, fill=(255,120,120,255), font=FONT)
    scale = cell / max(W, H)
    im = bg.convert("RGB").resize((int(W*scale), int(H*scale)))
    ImageDraw.Draw(im).text((6,4), f"{letter} {g['morse']}", fill=(255,220,120))
    return im

def main():
    glyphs = load()
    cell=220; cols=6; rows=math.ceil(26/cols)
    sheet = Image.new("RGB",(cols*cell, rows*cell),(8,8,10))
    for i,L in enumerate(ALPHABET):
        im = render_cell(L, glyphs, cell)
        r,c = divmod(i,cols)
        sheet.paste(im, (c*cell+(cell-im.width)//2, r*cell+(cell-im.height)//2))
    out = Path("/tmp/order_all.png"); sheet.save(out)
    print("wrote", out, sheet.size)
    # 顺序摘要
    for L in ALPHABET:
        seq = "".join("-" if m["type"]=="dash" else "." for m in glyphs[L]["markers"])
        pos = " ".join(f"({m['cx']:.0f},{m['cy']:.0f}){'—' if m['type']=='dash' else '·'}" for m in glyphs[L]["markers"])
        print(f"{L} {glyphs[L]['morse']:<5} order: {pos}")

if __name__ == "__main__":
    main()
