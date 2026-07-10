"""探测 U 白色字形的底部碗形中心线，输出 viewBox(100 宽) 坐标下的折线，
供 extractor 用作 U 的「划」路径（贴合弧形，而非游离直条）。"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "tool" / "_frames"

def white_mask(img):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 120) & (g > 120) & (b > 110)

for L in ["U", "V"]:
    img = Image.open(FRAMES / f"{L}_last.png")
    w, h = img.size
    sx = 100.0 / w
    m = white_mask(img)
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    print(f"\n{L}: frame {w}x{h}  white bbox x[{x0},{x1}] y[{y0},{y1}]  (vb: x[{x0*sx:.1f},{x1*sx:.1f}] y[{y0*sx:.1f},{y1*sx:.1f}])")
    # 底部碗：取 y 在下 35% 区间，按 x 分箱取白色中心 y
    ylo = y0 + (y1 - y0) * 0.62
    cols = []
    for xb in np.linspace(x0, x1, 13):
        xb = int(xb)
        colmask = m[:, max(0,xb-3):xb+4].any(axis=1)
        yy = np.nonzero(colmask & (np.arange(h) >= ylo))[0]
        if len(yy) > 2:
            cy = (yy.min() + yy.max()) / 2  # 该列白笔画中心
            cols.append((round(xb*sx,1), round(cy*sx,1)))
    print("  bowl centerline (vb):", cols)
