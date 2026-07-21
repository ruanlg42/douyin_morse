"""本地重渲 LOVE 钢琴 hook（不调 MiniMax），验证「延音尾巴」让钢琴不再戛然而止。
复用已存在的 AI 人声编曲轨 _music.mp3，只重渲摩斯钢琴轨并重混。完全离线。
另存一份纯 hook 波形（solo），便于单独听单个音的衰减尾巴。
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
from morse_api.styles import resolve as resolve_style
from morse_api.morse_codec import abbrev_to_morse
from morse_api.drum_synth import render_morse_hook_with_timeline, floats_to_wav_bytes_mono, _get_sf2_synth
from morse_api.main import _mix_hook_across_track, ASSETS_DIR

WORD, STYLE_ID, BASENAME = "LOVE", "healing", "sample_LOVE_healing_vocal"

cfg = load_config()
style = resolve_style(STYLE_ID)
if style.bpm_hint:
    cfg = replace(cfg, bpm=int(style.bpm_hint))
target_bpm = int(style.bpm_hint) if style.bpm_hint else int(cfg.bpm)

sf = _get_sf2_synth(cfg.sample_rate)
print(f"[SoundFont] {'✅' if sf else '❌'} | timbre={style.hook_timbre}")

morse = abbrev_to_morse(WORD)
hook_wave, hook_notes, hook_ms = render_morse_hook_with_timeline(
    morse.morse_dot_dash, cfg,
    root=style.key_root, scale=style.key_scale,
    octave=style.hook_octave, timbre=style.hook_timbre, bpm=target_bpm,
)
print(f"[hook] 波形时长={hook_wave.shape[0]/cfg.sample_rate:.2f}s (名义 hook_ms={hook_ms}ms) "
      f"→ 尾音余量={hook_wave.shape[0]/cfg.sample_rate - hook_ms/1000:.2f}s")

# 单独存一份 hook solo（归一化到 -1dB），直接听单音衰减是否丝滑不断
solo = hook_wave.copy()
p = float(np.max(np.abs(solo))) or 1.0
solo = solo * (0.891 / p)
wb = floats_to_wav_bytes_mono(np.clip(solo, -1, 1), cfg.sample_rate)
AudioSegment.from_file(BytesIO(wb), format="wav").export(
    ASSETS_DIR / f"{BASENAME}_hookSOLO.mp3", format="mp3", bitrate="256k")

music_bytes = (ASSETS_DIR / f"{BASENAME}_music.mp3").read_bytes()
mixed, meta, stems = _mix_hook_across_track(
    hook_wave, hook_notes, hook_ms, music_bytes,
    sample_rate=cfg.sample_rate, base_overlay_db=style.drum_overlay_db, target_bpm=target_bpm,
)
(ASSETS_DIR / f"{BASENAME}.mp3").write_bytes(mixed)
(ASSETS_DIR / f"{BASENAME}_music.mp3").write_bytes(stems["music"])
(ASSETS_DIR / f"{BASENAME}_morse.mp3").write_bytes(stems["morse"])
print(f"[done] 已重写合并/人声/摩斯轨 + hookSOLO；meta={meta}")
