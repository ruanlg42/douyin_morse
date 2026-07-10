"""
从 tool/_seq 与 tool/_frames 提取字母象形摩斯标记坐标，生成 frontend/src/letterGlyphs.js。
运行：/opt/anaconda3/bin/python3 tool/extract_letter_glyphs_from_frames.py
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SEQ_DIR = ROOT / "tool" / "_seq"
FRAMES_DIR = ROOT / "tool" / "_frames"
OUT_FILE = ROOT / "frontend" / "src" / "letterGlyphs.js"

ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
MORSE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.",
    "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-", "L": ".-..",
    "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.",
    "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": "-..-",
    "Y": "-.--", "Z": "--..",
}

VB_W = 100.0


def yellow_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (14, 90, 90), (45, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m


def read_seq_frames(letter: str):
    files = sorted(SEQ_DIR.glob(f"{letter}_*.png"))
    if not files:
        last = FRAMES_DIR / f"{letter}_last.png"
        return [cv2.imread(str(last))] if last.exists() else []
    return [cv2.imread(str(f)) for f in files]


def detect_markers(bgr, sx, sy):
    mask = yellow_mask(bgr)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
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
        })
    return out


def new_yellow_centroids(prev_bgr, curr_bgr, min_area=80):
    """两帧差分：本帧新出现的黄色连通域中心。"""
    prev = yellow_mask(prev_bgr)
    curr = yellow_mask(curr_bgr)
    diff = cv2.bitwise_and(curr, cv2.bitwise_not(prev))
    diff = cv2.morphologyEx(diff, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(diff, 8)
    out = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            continue
        cx, cy = centroids[i]
        comp = (labels == i).astype(np.uint8)
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        c = max(cnts, key=cv2.contourArea)
        (rcx, rcy), (rw, rh), ang = cv2.minAreaRect(c)
        long_side = max(rw, rh)
        short_side = max(min(rw, rh), 1.0)
        if rw < rh:
            angle = ang + 90.0
            L, T = rh, rw
        else:
            angle = ang
            L, T = rw, rh
        out.append({
            "cx": float(rcx), "cy": float(rcy), "angle": float(angle),
            "long": float(L), "short": float(T),
            "ratio": float(long_side / short_side), "area": int(area),
        })
    return out


def markers_from_frame_diff(frames, morse):
    """按动画逐帧差分，再按时间间隙合并为与摩斯等长的若干标记。"""
    blobs = []
    prev = frames[0]
    for fi in range(1, len(frames)):
        for b in new_yellow_centroids(prev, frames[fi]):
            blobs.append({**b, "frame": fi})
        prev = frames[fi]
    if not blobs:
        return []

    # 时间轴上相邻帧的差分归为同一符号；帧号跳变较大则开新符号
    groups = [[blobs[0]]]
    for b in blobs[1:]:
        if b["frame"] - groups[-1][-1]["frame"] > 1:
            groups.append([b])
        else:
            groups[-1].append(b)

    markers = []
    for grp in groups:
        total = sum(b["area"] for b in grp)
        cx = sum(b["cx"] * b["area"] for b in grp) / total
        cy = sum(b["cy"] * b["area"] for b in grp) / total
        rep = max(grp, key=lambda b: b["area"])
        markers.append({
            **rep,
            "cx": float(cx),
            "cy": float(cy),
            "_ord": grp[0]["frame"],
        })

    # 若合并后仍偏多，按面积取前 N 个再按出现顺序排
    if len(markers) > len(morse):
        markers.sort(key=lambda m: m["_ord"])
        # 相邻合并：贪心把过近的标记再并（动画分段过细时）
        merged = [markers[0]]
        for m in markers[1:]:
            last = merged[-1]
            dist = ((m["cx"] - last["cx"]) ** 2 + (m["cy"] - last["cy"]) ** 2) ** 0.5
            if len(merged) < len(morse) and dist < 22 and m["_ord"] - last["_ord"] <= 5:
                total = last.get("area", 1) + m.get("area", 1)
                last["cx"] = (last["cx"] * last.get("area", 1) + m["cx"] * m.get("area", 1)) / total
                last["cy"] = (last["cy"] * last.get("area", 1) + m["cy"] * m.get("area", 1)) / total
                last["area"] = total
                last["_ord"] = min(last["_ord"], m["_ord"])
            else:
                merged.append(m)
        markers = merged[: len(morse)]

    markers.sort(key=lambda m: m["_ord"])
    return markers[: len(morse)]


def final_yellow_blobs(bgr):
    """末帧黄色连通域 → 中心 + minAreaRect。"""
    mask = yellow_mask(bgr)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
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
        if rw < rh:
            angle = ang + 90.0
            L, T = rh, rw
        else:
            angle = ang
            L, T = rw, rh
        out.append({
            "cx": float(cx), "cy": float(cy), "angle": float(angle),
            "long": float(L), "short": float(T), "area": int(area),
        })
    return out


def match_ordered_markers(tracked, finals):
    """按动画顺序的粗定位 ↔ 末帧精确连通域，一一匹配。"""
    if not tracked or not finals:
        return []
    if len(tracked) == len(finals):
        pairs = []
        used = set()
        for t in sorted(tracked, key=lambda m: m["_ord"]):
            best_i, best_d = None, 1e18
            for i, f in enumerate(finals):
                if i in used:
                    continue
                d = (t["cx"] - f["cx"]) ** 2 + (t["cy"] - f["cy"]) ** 2
                if d < best_d:
                    best_d, best_i = d, i
            used.add(best_i)
            pairs.append((t, finals[best_i]))
        pairs.sort(key=lambda p: p[0]["_ord"])
        return [f for _, f in pairs]
    return finals[: len(tracked)]


def process(letter: str):
    frames = [f for f in read_seq_frames(letter) if f is not None]
    if not frames:
        return None, False
    last = frames[-1]
    h, w = last.shape[:2]
    sx = VB_W / w
    sy = VB_W / w
    vb_h = round(h * sy, 1)

    morse = MORSE[letter]
    tracked = markers_from_frame_diff(frames, morse)
    finals = final_yellow_blobs(last)

    if len(tracked) < len(morse) and len(finals) >= len(morse):
        finals_sorted = sorted(finals, key=lambda m: (m["cy"], m["cx"]))
        markers = finals_sorted[: len(morse)]
    else:
        markers = match_ordered_markers(tracked, finals)
        if len(markers) < len(morse):
            markers = (finals if len(finals) >= len(morse)
                       else tracked)[: len(morse)]

    ok = len(markers) == len(morse)

    result_markers = []
    for idx, sym in enumerate(morse):
        if idx < len(markers):
            m = markers[idx]
            is_dash = sym == "-"
            cx = round(m["cx"] * sx, 2)
            cy = round(m["cy"] * sy, 2)
            if is_dash:
                result_markers.append({
                    "type": "dash",
                    "cx": cx, "cy": cy,
                    "len": round(min(m["long"] * sx, 32), 2),
                    "thick": round(min(max(m["short"] * sy, 5.0), 11), 2),
                    "angle": round(m["angle"], 1),
                })
            else:
                r = round(max(m["long"], m["short"]) * 0.5 * sx, 2)
                result_markers.append({
                    "type": "dot",
                    "cx": cx, "cy": cy,
                    "r": max(r, 3.5),
                })
        else:
            result_markers.append({
                "type": "dot" if sym == "." else "dash",
                "cx": 50, "cy": 70, "r": 5,
                "len": 18, "thick": 8, "angle": 0,
            })

    return {
        "morse": morse,
        "viewBox": f"0 0 {round(VB_W, 1)} {vb_h}",
        "markers": result_markers,
    }, ok


def main():
    result = {}
    issues = []
    for letter in ALPHABET:
        data, ok = process(letter)
        if not data:
            issues.append(f"{letter}:no_frames")
            continue
        result[letter] = data
        got = len(data["markers"])
        want = len(MORSE[letter])
        if not ok:
            issues.append(f"{letter}:{got}/{want}")
        print(f"{letter}: {'OK' if ok else '!!'} morse={data['morse']} markers={got}")

    OUT_FILE.write_text(
        "// Auto-generated by tool/extract_letter_glyphs_from_frames.py\n"
        "export const LETTER_GLYPHS = "
        + json.dumps(result, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print("\nissues:", issues or "none")
    print("written", OUT_FILE)


if __name__ == "__main__":
    main()
