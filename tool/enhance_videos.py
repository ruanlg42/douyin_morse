"""
批量用 ffmpeg 提升字母教学视频画质（降噪、锐化、2× 缩放、提帧率）。
默认目录相对本仓库：frontend/public/letter → frontend/public/letter_hd。
可通过环境变量 LETTER_INPUT_DIR、LETTER_OUTPUT_DIR 覆盖。
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_IN = _REPO_ROOT / "frontend" / "public" / "letter"
_DEFAULT_OUT = _REPO_ROOT / "frontend" / "public" / "letter_hd"

INPUT_DIR = Path(os.environ.get("LETTER_INPUT_DIR", _DEFAULT_IN))
OUTPUT_DIR = Path(os.environ.get("LETTER_OUTPUT_DIR", _DEFAULT_OUT))

TARGET_WIDTH = 1280
TARGET_HEIGHT = 1536
TARGET_FPS = 30


def build_ffmpeg_cmd(input_path: Path, output_path: Path) -> list[str]:
    filter_chain = (
        f"hqdn3d=4:3:6:4.5,"
        f"unsharp=5:5:1.5:5:5:0.3,"
        f"scale={TARGET_WIDTH}:{TARGET_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"scale=ceil(iw/2)*2:ceil(ih/2)*2:flags=lanczos,"
        f"fps={TARGET_FPS}"
    )
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        filter_chain,
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-movflags",
        "+faststart",
        "-an",
        str(output_path),
    ]


def process_all() -> None:
    print("=" * 50)
    print("视频清晰度增强")
    print("=" * 50)
    print(f"输入: {INPUT_DIR}")
    print(f"输出: {OUTPUT_DIR}")
    print(f"目标分辨率: {TARGET_WIDTH}x{TARGET_HEIGHT}，{TARGET_FPS}fps")
    print("=" * 50)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total = len(ALPHABET)
    success = 0
    failed: list[tuple[str, str]] = []

    for i, letter in enumerate(ALPHABET, 1):
        input_file = INPUT_DIR / f"{letter}.mp4"
        output_file = OUTPUT_DIR / f"{letter}.mp4"

        if not input_file.is_file():
            print(f"[{i:02d}/{total}] {letter}: 源文件不存在，跳过")
            continue

        print(f"[{i:02d}/{total}] 处理 {letter}.mp4 ...", end=" ", flush=True)
        try:
            result = subprocess.run(
                build_ffmpeg_cmd(input_file, output_file),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if result.returncode == 0:
                o = input_file.stat().st_size
                n = output_file.stat().st_size
                print(f"完成 ({o / 1024:.1f}KB -> {n / 1024:.1f}KB)")
                success += 1
            else:
                err = (result.stderr or "")[-200:] or "Unknown error"
                print(f"失败: {err}")
                failed.append((letter, err))
        except Exception as e:
            print(f"异常: {e}")
            failed.append((letter, str(e)))

    print()
    print("=" * 50)
    print(f"处理完成: {success}/{total} 成功")
    if failed:
        print(f"失败: {[f[0] for f in failed]}")
    print("=" * 50)
    if success == total:
        print(f"\n可将 {OUTPUT_DIR} 内 mp4 复制到 {INPUT_DIR} 覆盖，供前端学习页使用。")


if __name__ == "__main__":
    process_all()
