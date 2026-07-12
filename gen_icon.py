#!/usr/bin/env python3
"""生成 300x300 猫头鹰信使图标（金色 × 深色星空）。
用 Pillow 4x 超采样绘制，再 LANCZOS 缩小，保证边缘平滑抗锯齿。
造型与游戏内 drawOwl 一致：蛋形深色身体 + 鎏金描边 + 大眼 + 角羽 + 金喙 + 环绕摩斯点划。"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 4                    # 超采样倍率
W = H = 300
CW, CH = W * S, H * S    # 画布（超采样）

GOLD      = (242, 210, 122)
GOLD_D    = (201, 162, 74)
GOLD_DEEP = (168, 124, 48)
CREAM     = (253, 246, 224)

img = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def lerp(a, b, t):
    return int(a + (b - a) * t)


# ---------- 背景：圆角方形 + 径向深紫→黑星空 ----------
cx, cy = CW / 2, CH * 0.44
maxd = CW * 0.72
bg = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
bgpx = bg.load()
for y in range(CH):
    for x in range(CW):
        dd = math.hypot(x - cx, y - cy) / maxd
        t = max(0.0, min(1.0, dd))
        r = lerp(30, 8, t)
        g = lerp(22, 6, t)
        b = lerp(46, 17, t)
        bgpx[x, y] = (r, g, b, 255)

# 圆角遮罩
mask = Image.new("L", (CW, CH), 0)
md = ImageDraw.Draw(mask)
rad = int(CW * 0.235)
md.rounded_rectangle([0, 0, CW - 1, CH - 1], radius=rad, fill=255)
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)

# ---------- 星星点缀 ----------
stars = [
    (0.16, 0.16, 2.1), (0.83, 0.13, 2.6), (0.90, 0.30, 1.6),
    (0.11, 0.34, 1.7), (0.20, 0.62, 1.5), (0.86, 0.60, 2.0),
    (0.74, 0.83, 1.6), (0.30, 0.86, 1.5), (0.50, 0.10, 1.8),
]
for sx, sy, sr in stars:
    px, py = sx * CW, sy * CH
    rr = sr * S
    d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=(255, 245, 216, 210))

# ---------- 头顶信号光点 + 光晕 ----------
sig_x, sig_y = CW / 2, CH * 0.135
halo = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)
hr = 30 * S
hd.ellipse([sig_x - hr, sig_y - hr, sig_x + hr, sig_y + hr], fill=(242, 210, 122, 90))
halo = halo.filter(ImageFilter.GaussianBlur(14 * S))
img = Image.alpha_composite(img, halo)
d = ImageDraw.Draw(img)
sr = 7 * S
d.ellipse([sig_x - sr, sig_y - sr, sig_x + sr, sig_y + sr], fill=CREAM)

# ---------- 猫头鹰 ----------
# 身体中心与尺寸（画布坐标）
ox, oy = CW / 2, CH * 0.645     # 身体底部锚点
cw = CW * 0.30                  # 半宽
ch = CH * 0.42                  # 高

# 蛋形身体（贝塞尔近似用多边形点）
def body_points():
    pts = []
    steps = 60
    # 左半：从顶点(0,-ch) 到底(0,0)
    for i in range(steps + 1):
        t = i / steps
        # 三次贝塞尔: P0=(0,-ch) C1=(-cw*1.05,-ch*0.85) C2=(-cw*1.05,-ch*0.05) P1=(0,0)
        mt = 1 - t
        x = (mt**3)*0 + 3*(mt**2)*t*(-cw*1.05) + 3*mt*(t**2)*(-cw*1.05) + (t**3)*0
        y = (mt**3)*(-ch) + 3*(mt**2)*t*(-ch*0.85) + 3*mt*(t**2)*(-ch*0.05) + (t**3)*0
        pts.append((ox + x, oy + y))
    # 右半：从底(0,0) 回到顶(0,-ch)
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = (mt**3)*0 + 3*(mt**2)*t*(cw*1.05) + 3*mt*(t**2)*(cw*1.05) + (t**3)*0
        y = (mt**3)*0 + 3*(mt**2)*t*(-ch*0.05) + 3*mt*(t**2)*(-ch*0.85) + (t**3)*(-ch)
        pts.append((ox + x, oy + y))
    return pts

# 身体渐变：顶部浅、底部深 —— 逐行裁剪填充
bpts = body_points()
xs = [p[0] for p in bpts]; ys = [p[1] for p in bpts]
bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)

body_mask = Image.new("L", (CW, CH), 0)
ImageDraw.Draw(body_mask).polygon(bpts, fill=255)
grad = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
gpx = grad.load()
for y in range(int(by0), int(by1) + 1):
    t = (y - by0) / max(1, (by1 - by0))
    r = lerp(74, 14, t)
    g = lerp(66, 10, t)
    b = lerp(84, 22, t)
    for x in range(int(bx0), int(bx1) + 1):
        gpx[x, y] = (r, g, b, 255)
img.paste(grad, (0, 0), body_mask)
d = ImageDraw.Draw(img)

# 身体金色描边
d.line(bpts + [bpts[0]], fill=(*GOLD, 150), width=int(2.2 * S), joint="curve")

# 腹部高光
d.ellipse([ox - cw*0.34, oy - ch*0.56, ox + cw*0.34, oy - ch*0.10], fill=(242, 210, 122, 26))

# 角羽（两枚三角）
tuft_y = oy - ch + 2*S
for sgn in (-1, 1):
    tx = ox + sgn * cw * 0.42
    d.polygon([(tx, tuft_y), (tx + sgn*6*S, tuft_y - 15*S), (tx - sgn*5*S, tuft_y - 2*S)],
              fill=(26, 22, 32, 255))

# 面盘（脸部浅色椭圆）
face_y = oy - ch * 0.66
d.ellipse([ox - cw*0.62, face_y - ch*0.20, ox + cw*0.62, face_y + ch*0.30],
          fill=(58, 50, 68, 130))

# 眼睛
eye_y = oy - ch * 0.70
eye_off = cw * 0.40
eye_r = cw * 0.34
for sgn in (-1, 1):
    ex = ox + sgn * eye_off
    # 眼白
    d.ellipse([ex - eye_r, eye_y - eye_r, ex + eye_r, eye_y + eye_r], fill=CREAM)
    # 金环
    gr = eye_r * 0.72
    d.ellipse([ex - gr, eye_y - gr, ex + gr, eye_y + gr], fill=(212, 167, 71, 255))
    # 黑瞳
    pr = eye_r * 0.42
    d.ellipse([ex - pr, eye_y - pr, ex + pr, eye_y + pr], fill=(10, 8, 8, 255))
    # 高光
    hlr = eye_r * 0.14
    hx, hy = ex + pr*0.35, eye_y - pr*0.4
    d.ellipse([hx - hlr, hy - hlr, hx + hlr, hy + hlr], fill=(255, 255, 255, 235))

# 喙（金色小三角）
beak_y = eye_y + eye_r * 1.15
d.polygon([(ox, beak_y + 9*S), (ox - 6*S, beak_y), (ox + 6*S, beak_y)], fill=GOLD_D)

# ---------- 环绕底部的摩斯点划「· − · ·」(L) ----------
row_y = oy + CH * 0.075
dot_r = 6.5 * S
dash_w, dash_h = 26*S, 12*S
gap = 9*S
syms = ['.', '-', '.', '.']
widths = [dot_r*2 if s == '.' else dash_w for s in syms]
total = sum(widths) + gap*(len(syms)-1)
x = ox - total/2
for s in syms:
    if s == '.':
        d.ellipse([x, row_y - dot_r, x + dot_r*2, row_y + dot_r], fill=GOLD)
        x += dot_r*2 + gap
    else:
        d.rounded_rectangle([x, row_y - dash_h/2, x + dash_w, row_y + dash_h/2],
                            radius=dash_h/2, fill=GOLD_D)
        x += dash_w + gap

# ---------- 缩小输出 ----------
out_img = img.resize((W, H), Image.LANCZOS)
out = Path(__file__).resolve().parent / "interactive_space" / "icon.png"
out_img.save(out)
print("wrote", out, out.stat().st_size, "bytes")
