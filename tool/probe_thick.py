"""测量每个字母 ghost 笔画（白∪黄）的局部宽度，与当前 dash thick 对比，
判断 dash 是否填满字形笔画。输出各字母 dash 处 ghost 垂直/水平厚度估计。"""
import json, re, math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "tool" / "_frames"
GLYPH_JS = ROOT / "frontend" / "src" / "letterGlyphs.js"

def masks(img):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r,g,b = a[...,0],a[...,1],a[...,2]
    white = (r>120)&(g>120)&(b>110)
    yellow = (r>150)&(g>90)&(b<120)&(r-b>70)&(g-b>30)
    return white, yellow

txt = GLYPH_JS.read_text(encoding="utf-8")
glyphs = json.loads(re.search(r"=\s*(\{.*\});\s*$", txt, re.S).group(1))

for L in ["D","B","O","Q","I","T","C","G"]:
    img = Image.open(FRAMES/f"{L}_last.png")
    w,h = img.size
    sx = 100.0/w
    white, yellow = masks(img)
    ghost = white | yellow
    g = glyphs[L]
    for mi,m in enumerate(g["markers"]):
        if m["type"]!="dash": continue
        # dash 中心在像素坐标
        pcx = m["cx"]/sx; pcy = m["cy"]/sx
        ang = math.radians(m.get("angle",0))
        # 垂直于 dash 方向测 ghost 连续宽度
        nx, ny = -math.sin(ang), math.cos(ang)
        # 从中心向两侧扫 ghost 连续长度
        def span(sign):
            d=0
            while d<80:
                px=int(round(pcx+nx*sign*d)); py=int(round(pcy+ny*sign*d))
                if 0<=px<w and 0<=py<h and ghost[py,px]: d+=1
                else: break
            return d
        gw = (span(1)+span(-1))*sx
        print(f"{L} dash#{mi}: thick={m['thick']:.1f}  ghost_width≈{gw:.1f}  (fill={m['thick']/max(gw,0.1)*100:.0f}%)")
