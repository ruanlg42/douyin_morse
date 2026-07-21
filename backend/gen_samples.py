"""批量生成示例曲（路线 A：music-3.0 文生曲 + 本地叠回摩斯 x）。

直接调用 _run_generate（绕过 HTTP），把成品存到 backend/morse_api/outputs/samples/，
文件名含 词/风格/人声，便于试听挑选优质案例。
"""
from __future__ import annotations
import sys, time, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import shutil
    if shutil.which("ffmpeg") is None:
        import static_ffmpeg
        static_ffmpeg.add_paths()
except Exception as e:  # noqa: BLE001
    print("static_ffmpeg:", e)

from morse_api.main import _run_generate

OUT = Path(__file__).resolve().parent / "morse_api" / "outputs" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

# (词, 风格id, 是否人声, 说明)  —— 用户要人声：全部 with_vocals=True
JOBS = [
    ("LOVE", "healing",   True, "治愈钢琴+人声·LOVE"),
    ("STAR", "lofi",      True, "LoFi+人声·STAR"),
    ("HOPE", "cinematic", True, "电影叙事+人声·HOPE"),
    ("MOON", "dream_pop", True, "梦境迷幻+人声·MOON"),
    ("HERO", "synthwave", True, "合成怀旧+人声·HERO"),
    ("FREE", "folk_acoustic", True, "民谣原声+人声·FREE"),
]


def main():
    results = []
    for word, style, vocals, desc in JOBS:
        tag = f"{word}_{style}_{'vocal' if vocals else 'inst'}"
        print(f"\n===== 生成 {tag}  ({desc}) =====", flush=True)
        t0 = time.time()
        try:
            def cb(stage, pct, _tag=tag):
                print(f"  [{_tag}] {stage} {pct}%", flush=True)
            res = _run_generate(
                word, style, with_vocals=vocals,
                asset_basename=f"sample_{tag}.mp3",  # 存进 assets/（flat 命名，前缀 sample_）
                progress_cb=cb,
            )
            dt = time.time() - t0
            info = {
                "tag": tag, "desc": desc, "sec": round(dt, 1),
                "audio_url": res.get("audio_url"),
                "hook_bpm": res.get("hook_bpm"),
                "beat_detected": res.get("beat_detected"),
                "first_hook_start_ms": res.get("first_hook_start_ms"),
            }
            results.append(info)
            print(f"  ✅ {tag} 完成 {dt:.1f}s -> {res.get('audio_url')}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {tag} 失败：{type(e).__name__}: {e}", flush=True)
            traceback.print_exc()

    print("\n\n========= 汇总 =========")
    for r in results:
        print(r)
    print(f"\n成品目录：{OUT}")


if __name__ == "__main__":
    main()
