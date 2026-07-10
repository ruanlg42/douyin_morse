"""生成参考帧 + 提取标记叠加图，便于逐字母核对。运行：/opt/anaconda3/bin/python3 tool/verify_letter_glyphs.py"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "tool" / "_frames"
OUT = ROOT / "tool" / "_verify"
GLYPHS = ROOT / "frontend" / "src" / "letterGlyphs.js"


def load_glyphs():
    text = GLYPHS.read_text(encoding="utf-8")
    return json.loads(text.split("=", 1)[1].rstrip(";\n"))


def draw_marker(img, m, sx, sy, color):
    cx, cy = int(m["cx"] * sx), int(m["cy"] * sy)
    if m["type"] == "dot":
        r = max(3, int(m.get("r", 4) * sx))
        cv2.circle(img, (cx, cy), r, color, -1, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), r + 2, (0, 255, 255), 1, cv2.LINE_AA)
    else:
        half = m.get("len", 16) * sx / 2
        rad = math.radians(m.get("angle", 0))
        x1 = int(cx - math.cos(rad) * half)
        y1 = int(cy - math.sin(rad) * half)
        x2 = int(cx + math.cos(rad) * half)
        y2 = int(cy + math.sin(rad) * half)
        thick = max(2, int(m.get("thick", 8) * sy))
        cv2.line(img, (x1, y1), (x2, y2), color, thick, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), 4, (0, 255, 255), 1, cv2.LINE_AA)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    glyphs = load_glyphs()
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        ref = cv2.imread(str(FRAMES / f"{letter}_last.png"))
        if ref is None:
            continue
        h, w = ref.shape[:2]
        sx, sy = w / 100.0, h / 100.0
        overlay = ref.copy()
        data = glyphs[letter]
        for i, m in enumerate(data["markers"]):
            draw_marker(overlay, m, sx, sy, (0, 0, 255))  # red overlay
            sym = data["morse"][i]
            cv2.putText(
                overlay, f"{i}:{sym}", (int(m["cx"] * sx) + 6, int(m["cy"] * sy) - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA,
            )
        blend = cv2.addWeighted(ref, 0.55, overlay, 0.45, 0)
        cv2.putText(blend, f"{letter} {data['morse']}", (8, 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(OUT / f"{letter}_verify.png"), blend)
        print(f"{letter} -> {OUT / f'{letter}_verify.png'}")
    print("done", OUT)


if __name__ == "__main__":
    main()
