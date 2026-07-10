"""
复刻浏览器 MorseLetterAnim 的合成结果：
  幽灵底图 PNG（letter-glyph/<L>.png, 640x768） + 按 letterGlyphs.js 的
  markers 坐标（100xVB 坐标系）绘制点/划。
用于离线肉眼核对点划是否落在字形上，绕过浏览器缓存/截图工具不确定性。

输出 /tmp/verify_<L>.png
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
GHOST_DIR = ROOT / "frontend" / "public" / "letter-glyph"
GLYPH_JS = ROOT / "frontend" / "src" / "letterGlyphs.js"


def load_glyphs():
    txt = GLYPH_JS.read_text(encoding="utf-8")
    m = re.search(r"=\s*(\{.*\});\s*$", txt, re.S)
    return json.loads(m.group(1))


def render(letter, glyphs):
    g = glyphs[letter]
    ghost = Image.open(GHOST_DIR / f"{letter}.png").convert("RGBA")
    W, H = ghost.size
    # viewBox 宽固定 100 → 缩放系数
    vb = g["viewBox"].split()
    vbw = float(vb[2]); vbh = float(vb[3])
    sx = W / vbw
    sy = H / vbh
    # 底图铺白便于观察
    bg = Image.new("RGBA", (W, H), (18, 18, 22, 255))
    bg.alpha_composite(ghost)
    d = ImageDraw.Draw(bg)
    for mk in g["markers"]:
        if mk["type"] == "dot":
            cx = mk["cx"] * sx; cy = mk["cy"] * sy
            r = mk.get("r", 4.4) * sx
            d.ellipse([cx - r, cy - r, cx + r, cy + r],
                      fill=(246, 217, 138, 255))
        else:
            pts = mk.get("pts")
            thick = int(round(mk.get("thick", 7) * sx))
            if pts and len(pts) >= 2:
                xy = [(x * sx, y * sy) for x, y in pts]
                d.line(xy, fill=(246, 217, 138, 255), width=max(thick, 3),
                       joint="curve")
            else:
                # 直线段：中心+角度+长度
                import math
                half = min(mk.get("len", 20), 34) / 2
                rad = math.radians(mk.get("angle", 0))
                ux, uy = math.cos(rad), math.sin(rad)
                x1 = (mk["cx"] - ux * half) * sx
                y1 = (mk["cy"] - uy * half) * sy
                x2 = (mk["cx"] + ux * half) * sx
                y2 = (mk["cy"] + uy * half) * sy
                d.line([(x1, y1), (x2, y2)], fill=(246, 217, 138, 255),
                       width=max(thick, 3))
    out = Path("/tmp") / f"verify_{letter}.png"
    bg.convert("RGB").save(out)
    print("wrote", out)


def main():
    glyphs = load_glyphs()
    letters = sys.argv[1:] or ["G", "W", "H", "J"]
    for L in letters:
        render(L, glyphs)


if __name__ == "__main__":
    main()
