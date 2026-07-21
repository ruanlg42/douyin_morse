"""生成单首架子鼓风格案例（HERO / synthwave，groove 套件）。
走全新的「节奏让路」提示词，AI 会重新编一版鼓组克制、给摩斯鼓点让骨架的曲子。
需调 MiniMax（music-3.0 + 文本模型写词/prompt）。
"""
import sys
sys.path.insert(0, "backend")

import shutil
if shutil.which("ffmpeg") is None:
    import static_ffmpeg  # type: ignore
    static_ffmpeg.add_paths()

from morse_api.main import _run_generate


def cb(stage, pct):
    print(f"  [{pct:3d}%] {stage}", flush=True)


print("=== 生成 HERO / synthwave（架子鼓 groove 节奏动机 + 人声）===", flush=True)
res = _run_generate(
    "HERO", "synthwave",
    with_vocals=True,
    asset_basename="sample_HERO_synthwave_vocal.mp3",
    progress_cb=cb,
)
print("OK stem_urls =", res.get("stem_urls"), flush=True)
print("   audio_url  =", res.get("audio_url"), flush=True)
print("   hook_bpm   =", res.get("hook_bpm"), "beat_detected =", res.get("beat_detected"), flush=True)
