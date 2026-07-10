"""检测哪些字母的白色字形触边被裁切。打印每个字母白色掩膜的 bbox 与边距。"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "tool" / "_frames"
ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def white_or_yellow(img):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    white = (r > 120) & (g > 120) & (b > 110)
    yellow = (r > 150) & (g > 90) & (b < 120) & (r - b > 70) & (g - b > 30)
    return white | yellow


for L in ALPHABET:
    p = FRAMES / f"{L}_last.png"
    if not p.exists():
        print(L, "no frame"); continue
    m = white_or_yellow(Image.open(p))
    h, w = m.shape
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        print(L, "empty"); continue
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    left, right = x0, w - 1 - x1
    top, bot = y0, h - 1 - y1
    edge = []
    if left <= 1: edge.append("L")
    if right <= 1: edge.append("R")
    if top <= 1: edge.append("T")
    if bot <= 1: edge.append("B")
    flag = "CLIP:" + "".join(edge) if edge else "ok"
    print(f"{L}: {flag:10s} bbox=({x0},{y0})-({x1},{y1}) margins L{left} R{right} T{top} B{bot} frame={w}x{h}")
