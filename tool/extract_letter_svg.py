"""
把 frontend/public/letter/*.mp4 每个字母的「白色字形 + 金色点划标记」提取成矢量数据。
输出 frontend/src/letterGlyphs.js，供 MorseLetterAnim 用纯 SVG 代码还原动画（不再播视频）。

- 白色字形：末帧白色区域 → 轮廓 → 多边形近似 → SVG path（填充）。
- 标记：黄色区域连通域 → 每块的中心/尺寸/朝向(minAreaRect)。dash 记录旋转角与长宽，dot 记录半径。
- 出现顺序：逐帧回溯每个标记中心首次变黄的帧序，按此排序并与摩斯序列对应。

运行：/opt/anaconda3/bin/python3 tool/extract_letter_svg.py
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LETTER_DIR = ROOT / "frontend" / "public" / "letter"
OUT_FILE = ROOT / "frontend" / "src" / "letterGlyphs.js"

ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
MORSE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..',
}

VB_W = 100.0  # 输出 viewBox 宽（高按视频比例）


def read_frames(letter: str):
    with tempfile.TemporaryDirectory() as td:
        pattern = str(Path(td) / "f_%03d.png")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(LETTER_DIR / f"{letter}.mp4"),
             "-vf", "fps=15", pattern],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        files = sorted(Path(td).glob("f_*.png"))
        return [cv2.imread(str(f)) for f in files]  # BGR


def yellow_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # 金黄色范围（H 15~45）
    m = cv2.inRange(hsv, (14, 90, 90), (45, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m


def white_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # 白色：低饱和 + 高明度
    m = cv2.inRange(hsv, (0, 0, 150), (180, 60, 255))
    return m


def letter_body_mask(bgr):
    """字形本体 = 白色 ∪ 黄色（黄色标记压在字形上，需并进来才完整）。"""
    body = cv2.bitwise_or(white_mask(bgr), yellow_mask(bgr))
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    body = cv2.morphologyEx(body, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return body


def contours_to_paths(mask, sx, sy):
    cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return []
    paths = []
    areas = [cv2.contourArea(c) for c in cnts]
    max_area = max(areas) if areas else 0
    for c, a in zip(cnts, areas):
        if a < max_area * 0.02 or a < 40:
            continue
        eps = 0.004 * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, eps, True)
        pts = approx.reshape(-1, 2)
        if len(pts) < 3:
            continue
        d = f"M{pts[0][0]*sx:.2f},{pts[0][1]*sy:.2f}"
        for p in pts[1:]:
            d += f"L{p[0]*sx:.2f},{p[1]*sy:.2f}"
        d += "Z"
        paths.append(d)
    return paths


def detect_markers(bgr, sx, sy):
    mask = yellow_mask(bgr)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < 120:
            continue
        comp = (labels == i).astype(np.uint8)
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        c = max(cnts, key=cv2.contourArea)
        (cx, cy), (rw, rh), ang = cv2.minAreaRect(c)
        long_side = max(rw, rh)
        short_side = max(min(rw, rh), 1.0)
        ratio = long_side / short_side
        # minAreaRect 的 angle 语义：让 width 对应角度方向
        if rw < rh:
            angle = ang + 90.0
            L, T = rh, rw
        else:
            angle = ang
            L, T = rw, rh
        out.append({
            "cx": cx, "cy": cy, "angle": float(angle),
            "long": float(L), "short": float(T),
            "ratio": float(ratio), "area": int(area),
            "px": (cx * sx, cy * sy),
        })
    return out


def appearance_order(frames, final_markers, sx, sy):
    """对每个末帧标记，找它中心首次变黄的帧号。"""
    masks = [yellow_mask(f) for f in frames]
    order = []
    for m in final_markers:
        cx, cy = int(round(m["cx"])), int(round(m["cy"]))
        first = len(frames)
        for fi, mk in enumerate(masks):
            h, w = mk.shape
            x0, x1 = max(0, cx - 4), min(w, cx + 5)
            y0, y1 = max(0, cy - 4), min(h, cy + 5)
            if mk[y0:y1, x0:x1].any():
                first = fi
                break
        order.append(first)
    return order


def process(letter: str):
    frames = read_frames(letter)
    if not frames:
        return None
    last = frames[-1]
    h, w = last.shape[:2]
    sx = VB_W / w
    sy = VB_W / w  # 等比，保持宽高比
    vb_h = h * sy

    body = letter_body_mask(last)
    paths = contours_to_paths(body, sx, sy)

    morse = MORSE[letter]
    markers = detect_markers(last, sx, sy)

    # 数量对齐：多则取最大的 N；少则告警
    markers.sort(key=lambda m: m["area"], reverse=True)
    target = len(morse)
    if len(markers) > target:
        markers = markers[:target]

    order = appearance_order(frames, markers, sx, sy)
    for m, o in zip(markers, order):
        m["_ord"] = o
    markers.sort(key=lambda m: (m["_ord"], m["cy"], m["cx"]))

    result_markers = []
    ok = len(markers) == target
    for idx, sym in enumerate(morse):
        if idx < len(markers):
            m = markers[idx]
            is_dash = (sym == '-')
            cx = round(m["cx"] * sx, 2)
            cy = round(m["cy"] * sy, 2)
            if is_dash:
                result_markers.append({
                    "type": "dash",
                    "cx": cx, "cy": cy,
                    "len": round(m["long"] * sx, 2),
                    "thick": round(max(m["short"] * sy, 5.0), 2),
                    "angle": round(m["angle"], 1),
                })
            else:
                r = round(max(m["long"], m["short"]) * 0.5 * sx, 2)
                result_markers.append({
                    "type": "dot",
                    "cx": cx, "cy": cy,
                    "r": max(r, 3.0),
                })
        else:
            result_markers.append({"type": "dot" if sym == '.' else "dash",
                                   "cx": 50, "cy": 50, "r": 5,
                                   "len": 18, "thick": 8, "angle": 0})
    return {
        "morse": morse,
        "viewBox": f"0 0 {round(VB_W,1)} {round(vb_h,1)}",
        "paths": paths,
        "markers": result_markers,
    }, ok, len(markers), target


def main():
    result = {}
    issues = []
    for letter in ALPHABET:
        data, ok, got, want = process(letter)
        result[letter] = data
        flag = "OK" if ok else f"!! {got}/{want}"
        if not ok:
            issues.append(f"{letter}:{got}/{want}")
        print(f"{letter}: {flag} paths={len(data['paths'])} morse={data['morse']}")
    OUT_FILE.write_text(
        "// Auto-generated by tool/extract_letter_svg.py — 矢量字形 + 摩斯标记（替代 letter/*.mp4）\n"
        "export const LETTER_GLYPHS = " + json.dumps(result, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print("\nissues:", issues or "none")
    print("written", OUT_FILE)


if __name__ == "__main__":
    main()
