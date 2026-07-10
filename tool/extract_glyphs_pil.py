"""
从 tool/_frames/<L>_last.png（点划全显末帧）精确提取象形摩斯标记，
用 tool/_seq/<L>_XX.png 的出现顺序把标记排成摩斯序列，
生成 frontend/src/letterGlyphs.js。

仅依赖 PIL + numpy（无需 cv2 / ffmpeg）。
运行：/usr/bin/python3 tool/extract_glyphs_pil.py
"""
from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES_DIR = ROOT / "tool" / "_frames"
SEQ_DIR = ROOT / "tool" / "_seq"
OUT_FILE = ROOT / "frontend" / "src" / "letterGlyphs.js"
GHOST_DIR = ROOT / "frontend" / "public" / "letter-glyph"

ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
MORSE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.",
    "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-", "L": ".-..",
    "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.",
    "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": "-..-",
    "Y": "-.--", "Z": "--..",
}

VB_W = 100.0
MIN_AREA = 260          # 过滤噪点（原图 640x768）
FRAME_MARGIN = 8.0      # viewBox 单位：字形四周留白，避免触边裁切（W/Q）
# 这些字母的「划」在源视频里是游离直条，按记忆位应贴合字形底部碗形弧线
BOWL_DASH_LETTERS = {"U"}


def yellow_mask(img: Image.Image) -> np.ndarray:
    """标记为暖黄/橙（高 R、中高 G、低 B）；字母主体为白（RGB 都高）。"""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # 黄/橙：R 高、G 中高、B 明显低，且不是白（白的 B 也高）
    return (r > 150) & (g > 90) & (b < 120) & (r - b > 70) & (g - b > 30)


def white_mask(img: Image.Image) -> np.ndarray:
    """字母白色主体：RGB 都较高且彼此接近。"""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 120) & (g > 120) & (b > 110)


def dilate(mask: np.ndarray, it: int = 1) -> np.ndarray:
    """3x3 十字膨胀（numpy 位移），补白色描边与黄色间的细缝。"""
    m = mask.copy()
    for _ in range(it):
        out = m.copy()
        out[1:, :] |= m[:-1, :]
        out[:-1, :] |= m[1:, :]
        out[:, 1:] |= m[:, :-1]
        out[:, :-1] |= m[:, 1:]
        m = out
    return m


def save_ghost_png(letter: str, img: Image.Image, out_dir: Path, tf):
    """把白∪黄的完整字母轮廓存成深灰剪影 PNG（透明背景），作为幽灵底图。
    应用与标记相同的取景归一化仿射变换 tf=(k,bx,by)，保证点划落在字母上。"""
    letter_mask = dilate(white_mask(img) | yellow_mask(img), 2)
    h, w = letter_mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    # 深灰字形（与旧幽灵描边同色系 #26262e）
    rgba[..., 0] = 38
    rgba[..., 1] = 38
    rgba[..., 2] = 46
    rgba[..., 3] = np.where(letter_mask, 255, 0).astype(np.uint8)
    ghost = Image.fromarray(rgba, "RGBA")

    k, bx, by = tf
    if abs(k - 1.0) > 1e-3 or abs(bx) > 1e-3 or abs(by) > 1e-3:
        # 前向 out = k*in + b → PIL AFFINE 需要 out→in 逆变换
        coeffs = (1.0 / k, 0.0, -bx / k, 0.0, 1.0 / k, -by / k)
        ghost = ghost.transform((w, h), Image.AFFINE, coeffs, resample=Image.BILINEAR)

    out_dir.mkdir(parents=True, exist_ok=True)
    ghost.save(out_dir / f"{letter}.png")


def frame_transform(img: Image.Image):
    """计算取景归一化仿射 out = k*in + b（像素坐标）：
    把字形 bbox 缩放（k≤1，不放大）并居中进 [MARGIN, size-MARGIN] 区域，
    使触边字母（W 左右、Q 上下）离开边缘、点划不再悬空。已在框内的字母 k=1 不动。"""
    mask = white_mask(img) | yellow_mask(img)
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return (1.0, 0.0, 0.0)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw = max(x1 - x0, 1); bh = max(y1 - y0, 1)
    bcx = (x0 + x1) / 2.0; bcy = (y0 + y1) / 2.0
    m_px = FRAME_MARGIN * w / VB_W
    avail_w = w - 2 * m_px; avail_h = h - 2 * m_px
    k = min(1.0, avail_w / bw, avail_h / bh)
    # 目标中心保持原位，再夹紧使缩放后 bbox 落在可用区
    half_w = k * bw / 2.0; half_h = k * bh / 2.0
    tcx = min(max(bcx, m_px + half_w), w - m_px - half_w)
    tcy = min(max(bcy, m_px + half_h), h - m_px - half_h)
    bx = tcx - k * bcx
    by = tcy - k * bcy
    return (k, bx, by)


def components(mask: np.ndarray, min_area: int):
    """4-连通连通域（BFS）。返回每个域的像素坐标列表。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        pix = []
        while q:
            y, x = q.popleft()
            pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(pix) >= min_area:
            comps.append(pix)
    return comps


def blob_geom(pix):
    """由像素集算中心、主轴角度、长短轴（PCA）。"""
    arr = np.array(pix, dtype=np.float64)          # (N, 2) = (y, x)
    ys = arr[:, 0]
    xs = arr[:, 1]
    cx = xs.mean()
    cy = ys.mean()
    # PCA
    cov = np.cov(np.stack([xs - cx, ys - cy]))
    if cov.shape == ():
        long_ax = short_ax = 1.0
        angle = 0.0
        vx, vy = 1.0, 0.0
    else:
        evals, evecs = np.linalg.eigh(cov)
        order = np.argsort(evals)[::-1]
        evals = evals[order]
        evecs = evecs[:, order]
        # 长轴方向
        vx, vy = evecs[0, 0], evecs[1, 0]
        angle = math.degrees(math.atan2(vy, vx))
        # 用投影跨度估长短轴（比特征值更贴合视觉尺寸）
        proj_long = (xs - cx) * vx + (ys - cy) * vy
        proj_short = (xs - cx) * (-vy) + (ys - cy) * vx
        long_ax = proj_long.max() - proj_long.min()
        short_ax = proj_short.max() - proj_short.min()
    area = len(pix)
    return {
        "cx": cx, "cy": cy, "angle": angle,
        "long": max(long_ax, 1.0), "short": max(short_ax, 1.0),
        "area": area,
        "_xs": xs, "_ys": ys,
        "_vx": vx, "_vy": vy,           # 主轴
    }


def dash_polyline(b, n_seg=7):
    """沿 dash blob 主轴切片取质心 → 折线（能贴合弧形笔画）。返回 (y,x) 列表（像素坐标）。"""
    xs = b["_xs"]; ys = b["_ys"]
    cx = b["cx"]; cy = b["cy"]
    vx = b["_vx"]; vy = b["_vy"]
    proj = (xs - cx) * vx + (ys - cy) * vy
    lo, hi = proj.min(), proj.max()
    if hi - lo < 1e-6:
        return [(cy, cx)]
    pts = []
    for k in range(n_seg + 1):
        t0 = lo + (hi - lo) * k / (n_seg + 1)
        t1 = lo + (hi - lo) * (k + 1) / (n_seg + 1)
        m = (proj >= t0) & (proj < t1) if k < n_seg else (proj >= t0)
        if m.sum() < 3:
            continue
        pts.append((float(ys[m].mean()), float(xs[m].mean())))
    return pts if len(pts) >= 2 else [(cy, cx)]


def bowl_polyline(img, n_bins=11):
    """探测字形底部碗形（U/V 等）的中心线折线，返回 (y,x) 像素坐标列表。
    用于把「游离直条」的划改画成贴合碗底弧线的划。"""
    m = white_mask(img)
    h, w = m.shape
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ylo = y0 + (y1 - y0) * 0.60      # 仅取下部 40% 作碗底
    pts = []
    for xb in np.linspace(x0, x1, n_bins):
        xb = int(round(xb))
        band = m[:, max(0, xb - 3):xb + 4].any(axis=1)
        yy = np.nonzero(band & (np.arange(h) >= ylo))[0]
        if len(yy) > 2:
            cy = (yy.min() + yy.max()) / 2.0
            pts.append((float(cy), float(xb)))
    return pts if len(pts) >= 3 else None


def ghost_stroke_width(stroke_mask, pl):
    """沿折线 pl（像素坐标 (y,x) 列表）采样，测字形笔画在垂直方向的连续宽度，
    返回中位数（像素）。让「划」按字母笔画粗细来画，填满而非留细缝。"""
    h, w = stroke_mask.shape
    widths = []
    n = len(pl)
    for i in range(n):
        py, px = pl[i]
        # 切线方向（用相邻点）
        if i == 0:
            ty, tx = pl[1][0] - py, pl[1][1] - px
        elif i == n - 1:
            ty, tx = py - pl[i - 1][0], px - pl[i - 1][1]
        else:
            ty, tx = pl[i + 1][0] - pl[i - 1][0], pl[i + 1][1] - pl[i - 1][1]
        norm = math.hypot(tx, ty) or 1.0
        # 法线 = 切线转 90°
        nx, ny = -ty / norm, tx / norm
        def span(sign):
            d = 0.0
            while d < 60:
                sx_ = int(round(px + nx * sign * (d + 1)))
                sy_ = int(round(py + ny * sign * (d + 1)))
                if 0 <= sx_ < w and 0 <= sy_ < h and stroke_mask[sy_, sx_]:
                    d += 1
                else:
                    break
            return d
        wpx = span(1) + span(-1) + 1
        if wpx > 2:
            widths.append(wpx)
    if not widths:
        return None
    widths.sort()
    return widths[len(widths) // 2]

def read_seq(letter):
    files = sorted(SEQ_DIR.glob(f"{letter}_*.png"))
    return [Image.open(f) for f in files]


def appearance_order(letter, blobs):
    """用 _seq 逐帧：每个末帧 blob 第一次变黄的帧号 → 出现顺序。"""
    seq = read_seq(letter)
    if not seq:
        return list(range(len(blobs)))
    masks = [yellow_mask(im) for im in seq]
    order_key = []
    for b in blobs:
        cy, cx = int(round(b["cy"])), int(round(b["cx"]))
        first = len(masks)  # 默认最后
        for fi, m in enumerate(masks):
            h, w = m.shape
            y0, y1 = max(0, cy - 6), min(h, cy + 7)
            x0, x1 = max(0, cx - 6), min(w, cx + 7)
            if m[y0:y1, x0:x1].mean() > 0.25:
                first = fi
                break
        order_key.append(first)
    return sorted(range(len(blobs)), key=lambda i: (order_key[i], blobs[i]["cy"], blobs[i]["cx"]))


# 每个字母标记的「书写/阅读顺序」策略（决定动画逐个点亮的先后）。
#   reading : 自上而下、同排自左而右（默认，最符合书写直觉）
#   ltr     : 纯自左而右
#   ttb     : 纯自上而下
# key 用像素坐标（原图 640x768，未取景变换前）。
WRITE_ORDER_STRATEGY = {
    # 需要显式指定的字母（其余走 reading 默认）
    "M": "ltr",   # 两撇：左撇→右撇
    "N": "ltr",   # 左竖→斜→右竖，整体自左而右
    "W": "ltr",   # 自左而右四笔
    "X": "reading",
}


def writing_order(letter, blobs, sx):
    """按字母书写/阅读顺序给 blob 排序：默认自上而下、同一水平排自左而右。
    比"视频变黄顺序"稳定可控（大弧质心变黄慢会导致次序错乱，如 G 右竖先于左弧）。
    坐标先按 sx 归一到 viewBox(0~100 宽)，再分带，band≈22 viewBox 单位为一排。"""
    strat = WRITE_ORDER_STRATEGY.get(letter, "reading")
    idx = list(range(len(blobs)))
    def vb(i):
        return blobs[i]["cx"] * sx, blobs[i]["cy"] * sx   # (x, y) in viewBox units
    if strat == "ltr":
        key = lambda i: (round(vb(i)[0] / 16), vb(i)[1])
    elif strat == "ttb":
        key = lambda i: (round(vb(i)[1] / 16), vb(i)[0])
    else:  # reading：先分行（cy 带），行内自左而右
        key = lambda i: (round(vb(i)[1] / 22), vb(i)[0])
    return sorted(idx, key=key)



def process(letter):
    last_path = FRAMES_DIR / f"{letter}_last.png"
    if not last_path.exists():
        return None, "no_last"
    img = Image.open(last_path)
    w, h = img.size
    sx = VB_W / w
    sy = VB_W / w
    vb_h = round(h * sy, 1)

    # 取景归一化：把字形缩放居中进带留白的框，触边字母(W/Q)不再裁切
    k, bx, by = frame_transform(img)

    def tf_pt(px, py):
        """像素坐标经取景变换后再缩放到 viewBox 单位。"""
        return ((px * k + bx) * sx, (py * k + by) * sy)

    # 导出与标记同源、同取景变换的字形底图 PNG（幽灵底图）
    save_ghost_png(letter, img, GHOST_DIR, (k, bx, by))

    # 碗形划：U 等字母的划贴合字形底部弧线（像素坐标折线）
    bowl_pl = bowl_polyline(img) if letter in BOWL_DASH_LETTERS else None

    # 字形笔画掩膜（白∪黄，轻膨胀补缝）：用于让「划」按字母笔画粗细填满
    stroke_mask = dilate(white_mask(img) | yellow_mask(img), 1)

    mask = yellow_mask(img)
    comps = components(mask, MIN_AREA)
    if not comps:
        return None, "no_blobs"
    blobs = [blob_geom(p) for p in comps]

    morse = MORSE[letter]
    n_dash = morse.count("-")

    # 分类特征：
    #  - traced：沿主轴切片质心连成的折线弧长（弯的划也能体现"长"）
    #  - elong：traced / 短轴 → 细长程度（对直线和弧都稳健）
    for b in blobs:
        pl = dash_polyline(b, n_seg=9)
        traced = 0.0
        for j in range(1, len(pl)):
            traced += math.hypot(pl[j][0] - pl[j - 1][0], pl[j][1] - pl[j - 1][1])
        b["traced"] = max(traced, b["long"])          # 直线时退回长轴
        b["elong"] = b["traced"] / max(b["short"], 1.0)
        b["ratio"] = b["long"] / max(b["short"], 1.0)

    # 期望数量校验
    if len(blobs) != len(morse):
        note = f"count {len(blobs)}/{len(morse)}"
    else:
        note = "ok"

    # 1) 先按 elong 稳健分类：取 elong 最大的 n_dash 个为「划」，其余为「点」
    idx_by_elong = sorted(range(len(blobs)), key=lambda i: blobs[i]["elong"], reverse=True)
    dash_idx = set(idx_by_elong[:n_dash])
    for i, b in enumerate(blobs):
        b["kind"] = "dash" if i in dash_idx else "dot"

    # 2) 各类别内部按「书写/阅读顺序」排队（稳定，不依赖视频变黄先后）
    order = writing_order(letter, blobs, sx)
    dash_queue = [blobs[i] for i in order if blobs[i]["kind"] == "dash"]
    dot_queue = [blobs[i] for i in order if blobs[i]["kind"] == "dot"]

    # 3) 沿摩斯序列，按符号类型取对应队列的下一个 blob（类型永远正确）
    markers = []
    di = ti = 0
    for sym in morse:
        want_dash = sym == "-"
        b = None
        if want_dash and di < len(dash_queue):
            b = dash_queue[di]; di += 1
        elif not want_dash and ti < len(dot_queue):
            b = dot_queue[ti]; ti += 1
        if b is None:
            markers.append({"type": "dash", "cx": 50, "cy": 60, "len": 20, "thick": 7, "angle": 0}
                           if want_dash else
                           {"type": "dot", "cx": 50, "cy": 60, "r": 5})
            continue
        cx, cy = tf_pt(b["cx"], b["cy"])
        cx = round(cx, 2); cy = round(cy, 2)
        if want_dash:
            # 碗形划：贴合字形底部弧线（U）；否则沿 blob 主轴切片
            use_bowl = bowl_pl is not None
            pl = bowl_pl if use_bowl else dash_polyline(b)
            pts = [[round(vx, 2), round(vy, 2)] for (vx, vy) in (tf_pt(px, py) for (py, px) in pl)]
            # 「划」按其所在字形笔画的实际宽度来画（填满字母笔画，不再留细缝）。
            # 沿折线测 ghost 笔画法向宽度中位数；乘 0.82 内缩，保留一圈深色描边。
            gw_px = ghost_stroke_width(stroke_mask, pl)
            if gw_px:
                width_px = gw_px * 0.82
            else:
                # 回退：面积/弧长
                arc_px = 0.0
                for j in range(1, len(pl)):
                    arc_px += math.hypot(pl[j][0] - pl[j - 1][0], pl[j][1] - pl[j - 1][1])
                width_px = b["area"] / max(arc_px, 1.0) if arc_px > 1 else b["short"]
            thick = round(min(max(width_px * k * sx, 4.0), 15.0), 2)
            # 碗形划的中心/角度由折线端点推导
            if use_bowl:
                cxv = round(sum(p[0] for p in pts) / len(pts), 2)
                cyv = round(sum(p[1] for p in pts) / len(pts), 2)
                ang = round(math.degrees(math.atan2(pts[-1][1] - pts[0][1], pts[-1][0] - pts[0][0])), 1)
            else:
                cxv, cyv, ang = cx, cy, round(b["angle"], 1)
            markers.append({
                "type": "dash", "cx": cxv, "cy": cyv,
                "len": round(min(b["long"] * k * sx, 34), 2),
                "thick": thick,
                "angle": ang,
                "pts": pts,
            })
        else:
            r = round(max(b["long"], b["short"]) * 0.5 * k * sx, 2)
            markers.append({"type": "dot", "cx": cx, "cy": cy, "r": max(min(r, 6.0), 3.5)})

    return {
        "morse": morse,
        "viewBox": f"0 0 {round(VB_W, 1)} {vb_h}",
        "markers": markers,
    }, note


def main():
    result = {}
    report = []
    for L in ALPHABET:
        data, note = process(L)
        if not data:
            report.append(f"{L}:{note}")
            print(f"{L}: FAIL {note}")
            continue
        result[L] = data
        kinds = "".join("-" if m["type"] == "dash" else "." for m in data["markers"])
        flag = "OK" if kinds == MORSE[L] else "??"
        print(f"{L}: {flag} morse={MORSE[L]} kinds={kinds} note={note}")
        if kinds != MORSE[L]:
            report.append(f"{L}:kinds={kinds}")

    OUT_FILE.write_text(
        "// Auto-generated by tool/extract_glyphs_pil.py — 从字母动画视频末帧提取\n"
        "export const LETTER_GLYPHS = "
        + json.dumps(result, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print("\nreport:", report or "all-good")
    print("written", OUT_FILE)


if __name__ == "__main__":
    main()
