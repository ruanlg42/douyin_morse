"""乐器音色试听生成器（不调 MiniMax）：
把同一段摩斯（默认 LOVE）用真实音源库里各种「敲击/拨弦衰减型」乐器各渲一版裸听样本，
带自然延音尾巴。输出到 assets/timbre_demo/ 供 A/B 挑选。完全离线。
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
from morse_api.morse_codec import abbrev_to_morse
from morse_api.drum_synth import (
    render_morse_hook_with_timeline, floats_to_wav_bytes_mono,
    _get_sf2_synth, _TIMBRE_TO_GM_PROGRAM,
)
from morse_api.main import ASSETS_DIR

WORD = "LOVE"
# 要试听的乐器（timbre 名 → 中文标签），全部是敲击/拨弦自然衰减型
TIMBRES = [
    ("piano", "大钢琴（当前）"),
    ("epiano", "电钢 Rhodes"),
    ("epiano-fm", "FM 电钢 DX"),
    ("harpsichord", "羽管键琴"),
    ("celeste", "钢片琴 Celeste"),
    ("vibraphone", "颤音琴 Vibraphone"),
    ("marimba", "马林巴 Marimba"),
    ("xylophone", "木琴 Xylophone"),
    ("tubular-bells", "管钟 Tubular Bells"),
    ("dulcimer", "扬琴 Dulcimer"),
    ("bell", "钟琴 Glockenspiel"),
    ("music-box", "八音盒 Music Box"),
    ("kalimba", "卡林巴 Kalimba"),
    ("koto", "日本筝 Koto"),
    ("harp", "竖琴 Harp"),
    ("jazz-guitar", "爵士吉他"),
    ("pluck", "尼龙吉他"),
    ("pizzicato", "弦乐拨奏 Pizzicato"),
    ("steel-drums", "钢鼓 Steel Drums"),
]

cfg = load_config()
cfg = replace(cfg, bpm=96)   # 统一速度，便于横向对比
sf = _get_sf2_synth(cfg.sample_rate)
print(f"[SoundFont] {'✅' if sf else '❌'}  词={WORD}  乐器数={len(TIMBRES)}")

out_dir = ASSETS_DIR / "timbre_demo"
out_dir.mkdir(parents=True, exist_ok=True)

morse = abbrev_to_morse(WORD)
# 用 C 大调五声、5 度音区，统一旋律走向，只变音色
for timbre, label in TIMBRES:
    prog = _TIMBRE_TO_GM_PROGRAM.get(timbre)
    w, _notes, ms = render_morse_hook_with_timeline(
        morse.morse_dot_dash, cfg,
        root="C", scale="major_pent", octave=5, timbre=timbre, bpm=96,
    )
    solo = w.copy()
    p = float(np.max(np.abs(solo))) or 1.0
    solo = solo * (0.891 / p)
    wb = floats_to_wav_bytes_mono(np.clip(solo, -1, 1), cfg.sample_rate)
    fn = out_dir / f"timbre_{timbre}.mp3"
    AudioSegment.from_file(BytesIO(wb), format="wav").export(fn, format="mp3", bitrate="256k")
    print(f"  ✅ {timbre:16s} GM#{prog:<3} {w.shape[0]/cfg.sample_rate:.2f}s  {label}")

print(f"[done] 全部输出到 {out_dir}")
