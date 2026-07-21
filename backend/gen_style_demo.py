"""风格动机总览试听（不调 MiniMax）：
按每个风格「实际配置的乐器 + 调式 + BPM」各渲一条摩斯动机裸听样本，
带自然延音。输出到 assets/style_demo/，供确认每个风格的一一对应音色。完全离线。
"""
import sys
sys.path.insert(0, "backend")

import shutil
if shutil.which("ffmpeg") is None:
    import static_ffmpeg  # type: ignore
    static_ffmpeg.add_paths()

from dataclasses import replace
from io import BytesIO
import numpy as np
from pydub import AudioSegment

from morse_api.config import load_config
from morse_api.styles import STYLES
from morse_api.morse_codec import abbrev_to_morse
from morse_api.drum_synth import (
    render_morse_hook_with_timeline, render_morse_drumkit_with_timeline,
    floats_to_wav_bytes_mono, _get_sf2_synth,
)
from morse_api.main import ASSETS_DIR

WORD = "LOVE"
base_cfg = load_config()
sf = _get_sf2_synth(base_cfg.sample_rate)
print(f"[SoundFont] {'✅' if sf else '❌'}  词={WORD}  风格数={len(STYLES)}")

out_dir = ASSETS_DIR / "style_demo"
out_dir.mkdir(parents=True, exist_ok=True)
morse = abbrev_to_morse(WORD)

for sid, s in STYLES.items():
    cfg = replace(base_cfg, bpm=int(s.bpm_hint)) if s.bpm_hint else base_cfg
    bpm = int(s.bpm_hint) if s.bpm_hint else int(cfg.bpm)
    if s.hook_kind == "percussive":
        w, _n, ms = render_morse_drumkit_with_timeline(
            morse.morse_dot_dash, cfg, kit=s.drum_kit, drum_preset=s.drum_preset, bpm=bpm)
        desc = f"🥁 架子鼓/{s.drum_kit}"
    else:
        w, _n, ms = render_morse_hook_with_timeline(
            morse.morse_dot_dash, cfg, root=s.key_root, scale=s.key_scale,
            octave=s.hook_octave, timbre=s.hook_timbre, bpm=bpm)
        desc = f"🎹 {s.hook_timbre}"
    solo = w.copy()
    p = float(np.max(np.abs(solo))) or 1.0
    solo = solo * (0.891 / p)
    wb = floats_to_wav_bytes_mono(np.clip(solo, -1, 1), cfg.sample_rate)
    AudioSegment.from_file(BytesIO(wb), format="wav").export(
        out_dir / f"style_{sid}.mp3", format="mp3", bitrate="256k")
    print(f"  ✅ {sid:14s} {desc:22s} {bpm}bpm {w.shape[0]/cfg.sample_rate:.2f}s")

print(f"[done] 全部输出到 {out_dir}")
