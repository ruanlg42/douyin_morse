"""批量生成完整歌曲案例（调 MiniMax music-3.0 + 人声）。
每首用「风格一一对应的乐器/架子鼓 + 节奏/旋律让路提示词」，带人声。
指数退避重试已在 minimax_client 内置。逐首生成，单首失败不影响后续。
"""
import sys
sys.path.insert(0, "backend")

import shutil
if shutil.which("ffmpeg") is None:
    import static_ffmpeg  # type: ignore
    static_ffmpeg.add_paths()

from morse_api.main import _run_generate

# (词, 风格ID, 展示标签) —— 挑乐器差异明显的几首
JOBS = [
    ("STAR", "oriental",   "东方禅意·古筝 Koto"),
    ("HOPE", "cinematic",  "电影叙事·管钟 Tubular Bells"),
    ("MOON", "dream_pop",  "梦境迷幻·卡林巴 Kalimba"),
    ("FREE", "funk",       "放克律动·架子鼓"),
]

for word, style_id, label in JOBS:
    tag = f"{word}_{style_id}_vocal"
    print(f"\n===== 生成 {word} / {label} =====", flush=True)
    def cb(stage, pct, _w=word):
        print(f"  [{pct:3d}%] {stage}", flush=True)
    try:
        res = _run_generate(
            word, style_id, with_vocals=True,
            asset_basename=f"sample_{tag}.mp3", progress_cb=cb,
        )
        print(f"  ✅ OK {word}: {res.get('audio_url')} stems={list((res.get('stem_urls') or {}).keys())}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  ❌ FAIL {word}: {type(e).__name__}: {e}", flush=True)

print("\n[ALL DONE]", flush=True)
