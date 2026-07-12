"""
鼓点合成模块：将摩斯点划映射为可循环鼓点音频。

节奏映射（与题目一致，BPM 与 dash_ratio 可配置）：
- 「·」短音：一个 16 分音符时长 → 轻小鼓/拍手质感（短噪声 + 高频点击）
- 「−」长音：短音的 dash_ratio 倍时长（默认 4.0 = 四分音符）→ 重低音鼓（带音高包络的正弦近似 Kick）
- 字母间空格：休止（默认按摩斯惯例使用 3 个「16 分休止」；与字母间空格语义一致）
- 符间停顿：1 个 16 分休止

说明：原实现使用「16 分 vs 二分」(=8 倍) 会让横线拖得很长，节奏偏慢；
现在通过 DemoConfig.dash_ratio 控制长短比（默认 4.0），在不丢失辨识度的
前提下让整体鼓点更紧凑；题目中「短:长 = 1:2」可将 dash_ratio 设为 2.0。
"""
from __future__ import annotations

import logging
import wave
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np

from .config import DemoConfig

logger = logging.getLogger(__name__)


def _sixteenth_sec(bpm: float) -> float:
    beat = 60.0 / bpm
    return beat / 4.0


def _dash_sec(bpm: float, dash_ratio: float) -> float:
    """长音时长 = 短音(16 分音符) × dash_ratio。"""
    return _sixteenth_sec(bpm) * max(1.0, float(dash_ratio))


def _synth_snare_hit(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """短促小鼓/拍手：噪声 + 弱正弦，包络快速衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    decay = np.exp(-t * 90.0)
    noise = rng.standard_normal(n).astype(np.float64) * decay
    tone = 0.12 * np.sin(2.0 * np.pi * 220.0 * t) * decay
    x = (noise + tone).astype(np.float32)
    peak = float(np.max(np.abs(x))) or 1.0
    x *= 0.65 / peak
    return x


def _synth_kick_hit(duration_sec: float, sr: int) -> np.ndarray:
    """长低音鼓：频率随时间下降，振幅慢衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = 55.0 + 75.0 * np.exp(-t * 28.0)
    phase = np.cumsum(2.0 * np.pi * freq / sr)
    env = np.exp(-t * 2.2)
    x = (env * np.sin(phase)).astype(np.float32)
    peak = float(np.max(np.abs(x))) or 1.0
    x *= 0.92 / peak
    return x


# ---------- 风格化乐器合成（short/long 两组，供 styles.py 引用） ----------
def _norm(x: np.ndarray, target: float = 0.85) -> np.ndarray:
    peak = float(np.max(np.abs(x))) or 1.0
    return (x * (target / peak)).astype(np.float32)


def _marimba_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """木质马林巴感：高次谐波的快速衰减木琴点。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 880.0
    env = np.exp(-t * 30.0)
    tone = (
        np.sin(2 * np.pi * f0 * t)
        + 0.35 * np.sin(2 * np.pi * f0 * 4.0 * t)
        + 0.12 * np.sin(2 * np.pi * f0 * 9.0 * t)
    )
    click = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 400.0) * 0.25
    return _norm((env * tone + click).astype(np.float32), 0.7)


def _bass_pluck_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """温暖指弹贝斯音：低频基音 + 温和的衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 65.0
    env = np.exp(-t * 2.6) * (1.0 - np.exp(-t * 120.0))
    tone = np.sin(2 * np.pi * f0 * t) + 0.3 * np.sin(2 * np.pi * f0 * 2 * t)
    thump = np.exp(-t * 60.0) * rng.standard_normal(n).astype(np.float64) * 0.05
    return _norm((env * tone + thump).astype(np.float32), 0.88)


def _clap_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """Lo-Fi soft clap：三次微错位短噪声叠合。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    base = np.zeros(n, dtype=np.float64)
    offsets = [0.0, 0.012, 0.022]
    for off in offsets:
        k = int(off * sr)
        if k >= n:
            break
        decay = np.exp(-(t - off) * 120.0)
        decay = np.where(t < off, 0.0, decay)
        base += rng.standard_normal(n).astype(np.float64) * decay
    # 轻度带通（简单模拟）
    base *= np.hanning(n) ** 0.25
    return _norm(base.astype(np.float32), 0.65)


def _tape_kick_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """Lo-Fi 闷底鼓：和 kick 类似但多一层饱和与磁带底噪。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = 48.0 + 55.0 * np.exp(-t * 30.0)
    phase = np.cumsum(2.0 * np.pi * freq / sr)
    env = np.exp(-t * 2.6)
    body = env * np.sin(phase)
    saturated = np.tanh(body * 2.1) * 0.8
    hiss = rng.standard_normal(n).astype(np.float64) * 0.015 * np.exp(-t * 1.0)
    return _norm((saturated + hiss).astype(np.float32), 0.85)


def _square_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """8-bit 方波短音。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 1320.0
    env = np.exp(-t * 45.0)
    square = np.sign(np.sin(2 * np.pi * f0 * t))
    return _norm((env * square).astype(np.float32), 0.55)


def _square_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """8-bit 方波长音：低频脉冲。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 220.0
    env = np.exp(-t * 4.0) * (1.0 - np.exp(-t * 80.0))
    square = np.sign(np.sin(2 * np.pi * f0 * t))
    return _norm((env * square).astype(np.float32), 0.7)


def _taiko_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """和太鼓感：中频噪声 + 窄带共振。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    env = np.exp(-t * 55.0)
    noise = rng.standard_normal(n).astype(np.float64) * env
    tone = 0.5 * np.sin(2 * np.pi * 180.0 * t) * env
    return _norm((noise + tone).astype(np.float32), 0.78)


def _timpani_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """定音鼓：低频正弦缓降 + 宽空间感。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = 60.0 + 35.0 * np.exp(-t * 8.0)
    phase = np.cumsum(2.0 * np.pi * freq / sr)
    env = np.exp(-t * 1.6)
    body = env * np.sin(phase)
    crackle = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 70.0) * 0.08
    return _norm((body + crackle).astype(np.float32), 0.95)


def _hihat_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """紧致 hi-hat：高频噪声极短衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    noise = rng.standard_normal(n).astype(np.float64)
    # 简易高通：差分 → 衰减主低频
    hp = np.concatenate(([0.0], np.diff(noise)))
    env = np.exp(-t * 180.0)
    x = hp * env
    return _norm(x.astype(np.float32), 0.55)


def _sub_kick_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """EDM sub kick：极低频 + 轻度饱和，尾音充实。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = 42.0 + 90.0 * np.exp(-t * 22.0)
    phase = np.cumsum(2.0 * np.pi * freq / sr)
    env = np.exp(-t * 1.8)
    body = env * np.sin(phase)
    sat = np.tanh(body * 2.5) * 0.9
    click = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 160.0) * 0.05
    return _norm((sat + click).astype(np.float32), 0.95)


def _brush_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """爵士刷点：柔顺噪声包络，仿鼓刷触感。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    noise = rng.standard_normal(n).astype(np.float64)
    # 窄带化
    noise = noise - np.mean(noise)
    env = (1.0 - np.exp(-t * 220.0)) * np.exp(-t * 40.0)
    x = noise * env
    return _norm(x.astype(np.float32), 0.5)


def _rim_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """木制 rim / nylon 轻击：中频窄带 + 极短衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 760.0
    env = np.exp(-t * 120.0)
    tone = (np.sin(2 * np.pi * f0 * t) + 0.4 * np.sin(2 * np.pi * f0 * 2.0 * t)) * env
    click = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 300.0) * 0.12
    return _norm((tone + click).astype(np.float32), 0.6)


def _woodblock_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """木鱼/东方木块：明亮中高频窄带 + 干燥点击，极短衰减。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 1100.0
    env = np.exp(-t * 180.0)
    tone = (
        np.sin(2 * np.pi * f0 * t)
        + 0.5 * np.sin(2 * np.pi * f0 * 1.6 * t)
        + 0.2 * np.sin(2 * np.pi * f0 * 3.1 * t)
    ) * env
    click = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 500.0) * 0.18
    return _norm((tone + click).astype(np.float32), 0.65)


def _slap_bass_long(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """Funk slap bass：低频基音 + 颗粒 attack + 轻度饱和。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 85.0
    env = np.exp(-t * 3.2) * (1.0 - np.exp(-t * 200.0))
    fundamental = np.sin(2 * np.pi * f0 * t) + 0.4 * np.sin(2 * np.pi * f0 * 2.0 * t)
    body = np.tanh(fundamental * 1.8) * env
    pluck = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 220.0) * 0.12
    return _norm((body + pluck).astype(np.float32), 0.9)


def _bell_short(rng: np.random.Generator, duration_sec: float, sr: int) -> np.ndarray:
    """玻璃铃/钟琴：高次谐波 + 轻微非整数泛音，适合梦幻/节日感。"""
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    f0 = 1760.0
    env = np.exp(-t * 20.0)
    tone = (
        np.sin(2 * np.pi * f0 * t)
        + 0.5 * np.sin(2 * np.pi * f0 * 2.76 * t)
        + 0.25 * np.sin(2 * np.pi * f0 * 5.4 * t)
    ) * env
    shimmer = rng.standard_normal(n).astype(np.float64) * np.exp(-t * 120.0) * 0.05
    return _norm((tone + shimmer).astype(np.float32), 0.55)


# (voice_id) -> 合成函数：均接收 (rng, duration_sec, sr) -> float32 mono
VOICE_REGISTRY: dict[str, callable] = {
    "snare_short": _synth_snare_hit,
    "kick_long": lambda rng, d, sr: _synth_kick_hit(d, sr),
    "marimba_short": _marimba_short,
    "bass_pluck_long": _bass_pluck_long,
    "clap_short": _clap_short,
    "tape_kick_long": _tape_kick_long,
    "square_short": _square_short,
    "square_long": _square_long,
    "taiko_short": _taiko_short,
    "timpani_long": _timpani_long,
    "hihat_short": _hihat_short,
    "sub_kick_long": _sub_kick_long,
    "brush_short": _brush_short,
    "rim_short": _rim_short,
    "woodblock_short": _woodblock_short,
    "slap_bass_long": _slap_bass_long,
    "bell_short": _bell_short,
}


# 前端视觉原型：每个合成音色对应一类"点/划出来"的动画风格。
#   bloom —— 柔和泛起 + 金色光晕缓收（木琴/铃这类带延音的音色）
#   hit   —— 砸落 + 同心金环涟漪（大鼓/低频冲击）
#   crisp —— 极短一闪 + 轻微抖动，无涟漪（镲、鼓边、拍手、刷、木鱼）
#   pixel —— 阶梯式硬切 + 像素锯齿（chiptune 方波）
#   pluck —— 符号横向小幅抖动 + 余震（拨弦/slap bass）
VOICE_EFFECT_MAP: dict[str, str] = {
    "snare_short": "crisp",
    "kick_long": "hit",
    "marimba_short": "bloom",
    "bass_pluck_long": "pluck",
    "clap_short": "crisp",
    "tape_kick_long": "hit",
    "square_short": "pixel",
    "square_long": "pixel",
    "taiko_short": "hit",
    "timpani_long": "hit",
    "hihat_short": "crisp",
    "sub_kick_long": "hit",
    "brush_short": "crisp",
    "rim_short": "crisp",
    "woodblock_short": "crisp",
    "slap_bass_long": "pluck",
    "bell_short": "bloom",
}


def effect_for_voice(voice_id: str) -> str:
    """根据音色 id 返回前端该用的视觉原型 id，未知音色回落到 bloom。"""
    return VOICE_EFFECT_MAP.get(voice_id, "bloom")


def _silence(duration_sec: float, sr: int) -> np.ndarray:
    n = max(0, int(duration_sec * sr))
    return np.zeros(n, dtype=np.float32)


def build_morse_drum_timeline(
    morse_dot_dash: str,
    bpm: float,
    sr: int,
    rng: np.random.Generator,
    dash_ratio: float = 4.0,
) -> np.ndarray:
    """
    由「空格分字母」的摩斯串生成单遍鼓点波形（mono float32, -1..1）。
    morse_dot_dash 示例：".-.. .. -.-. .- ..."
    dash_ratio：长音相对短音的时长倍数（默认 4.0，即四分音符）。
    """
    audio, _ = build_morse_drum_timeline_with_letters(
        morse_dot_dash,
        bpm,
        sr,
        rng,
        dash_ratio=dash_ratio,
        short_voice="snare_short",
        long_voice="kick_long",
    )
    return audio


def build_morse_drum_timeline_with_letters(
    morse_dot_dash: str,
    bpm: float,
    sr: int,
    rng: np.random.Generator,
    *,
    dash_ratio: float = 4.0,
    short_voice: str = "snare_short",
    long_voice: str = "kick_long",
) -> tuple[np.ndarray, list[dict]]:
    """
    同 build_morse_drum_timeline，但允许指定短/长音音色，并附带「字母时间轴」。

    letter_timeline: [
        {"letter": <None>, "morse": ".-..", "start_ms": 0, "end_ms": 1680},
        ...
    ]
    letter 字段由调用方按 morse 顺序回填，本函数只关心位置与时长。
    end_ms 不包含字母之间的 3*dt16 停顿。
    """
    if short_voice not in VOICE_REGISTRY:
        raise KeyError(f"未知短音音色：{short_voice}")
    if long_voice not in VOICE_REGISTRY:
        raise KeyError(f"未知长音音色：{long_voice}")
    short_fn = VOICE_REGISTRY[short_voice]
    long_fn = VOICE_REGISTRY[long_voice]

    dt16 = _sixteenth_sec(bpm)
    dt_dash = _dash_sec(bpm, dash_ratio)
    dt16_samples = int(round(dt16 * sr))
    dash_samples = int(round(dt_dash * sr))

    parts: list[np.ndarray] = []
    cursor_samples = 0
    letter_intervals: list[dict] = []

    tokens = morse_dot_dash.split()
    for ti, token in enumerate(tokens):
        letter_start = cursor_samples
        for idx, sym in enumerate(token):
            if sym == ".":
                hit = short_fn(rng, dt16, sr)
            elif sym == "-":
                hit = long_fn(rng, dt_dash, sr)
            else:
                continue
            parts.append(hit)
            cursor_samples += hit.shape[0]
            if idx < len(token) - 1:
                gap = _silence(dt16, sr)
                parts.append(gap)
                cursor_samples += gap.shape[0]
        letter_end = cursor_samples
        letter_intervals.append(
            {
                "morse": token,
                "start_ms": round(letter_start * 1000.0 / sr, 1),
                "end_ms": round(letter_end * 1000.0 / sr, 1),
            }
        )
        if ti < len(tokens) - 1:
            inter = _silence(3.0 * dt16, sr)
            parts.append(inter)
            cursor_samples += inter.shape[0]

    if not parts:
        parts.append(_silence(dt16, sr))
        cursor_samples += dt16_samples

    audio = np.concatenate(parts) if len(parts) else _silence(dt16, sr)
    _ = dash_samples  # 保留变量（便于未来扩展：strict sample 对齐）
    return audio, letter_intervals


def _loop_to_duration(audio: np.ndarray, sr: int, min_sec: float, max_sec: float) -> np.ndarray:
    """重复单遍图案直至时长 >= min_sec，并截断到 <= max_sec。"""
    if audio.size == 0:
        audio = np.zeros(int(sr * 0.1), dtype=np.float32)
    one = audio
    min_samples = int(min_sec * sr)
    max_samples = int(max_sec * sr)
    reps = max(1, int(np.ceil(min_samples / max(1, one.size))))
    out = np.tile(one, reps)
    if out.size > max_samples:
        out = out[:max_samples]
    return out


def _pad_to_bar_grid(audio: np.ndarray, sr: int, bpm: float) -> tuple[np.ndarray, int]:
    """
    将总时长对齐到完整小节，便于「循环小节数」为整数。
    返回 (对齐后的音频, 小节数)。
    """
    bar_sec = 4.0 * (60.0 / bpm)
    cur = len(audio) / sr
    bars = max(1, int(np.ceil(cur / bar_sec)))
    target_len = int(bars * bar_sec * sr)
    if len(audio) < target_len:
        pad = np.zeros(target_len - len(audio), dtype=np.float32)
        audio = np.concatenate([audio, pad])
    elif len(audio) > target_len:
        audio = audio[:target_len]
    return audio, bars


def normalize_peak(x: np.ndarray, headroom_db: float = 1.0) -> np.ndarray:
    peak = float(np.max(np.abs(x)))
    if peak <= 1e-9:
        return x
    gain = 10 ** (-headroom_db / 20.0) / peak
    return np.clip(x * gain, -1.0, 1.0).astype(np.float32)


def floats_to_wav_bytes_mono(x: np.ndarray, sr: int) -> bytes:
    """float32 mono [-1,1] → WAV 16-bit PCM bytes（文件内容）。"""
    x16 = (x * 32767.0).astype(np.int16)
    buf = BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(x16.tobytes())
    return buf.getvalue()


def save_wav(path: Path, x: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = floats_to_wav_bytes_mono(x, sr)
    path.write_bytes(data)


def save_mp3_from_wav_bytes(wav_bytes: bytes, mp3_path: Path, bitrate: int = 256_000) -> None:
    """
    使用 pydub 将 WAV 内存数据导出为 MP3（需系统安装 ffmpeg）。
    """
    try:
        from pydub import AudioSegment
    except ImportError as e:
        raise RuntimeError(
            "导出 MP3 需要安装 pydub，且系统 PATH 中可用 ffmpeg。\n"
            "pip install pydub\n"
            "macOS: brew install ffmpeg"
        ) from e

    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    seg = AudioSegment.from_file(BytesIO(wav_bytes), format="wav")
    seg.export(
        str(mp3_path),
        format="mp3",
        bitrate=f"{bitrate // 1000}k",
        parameters=["-ar", "44100"],
    )


def render_intro_drums_wav_bytes(
    morse_dot_dash: str,
    cfg: DemoConfig,
    *,
    pad_to_bar: bool = True,
) -> bytes:
    """
    仅生成「一遍」摩斯鼓点（短音=小军鼓质感，长音=底鼓质感），用于歌曲前奏叠加。
    保留向后兼容；内部委托给 render_intro_drums_with_timeline。
    """
    wav_bytes, _, _ = render_intro_drums_with_timeline(
        morse_dot_dash,
        cfg,
        short_voice="snare_short",
        long_voice="kick_long",
        pad_to_bar=pad_to_bar,
    )
    return wav_bytes


def render_intro_drums_with_timeline(
    morse_dot_dash: str,
    cfg: DemoConfig,
    *,
    short_voice: str = "snare_short",
    long_voice: str = "kick_long",
    pad_to_bar: bool = True,
) -> tuple[bytes, int, list[dict]]:
    """
    生成「一遍」摩斯鼓点 WAV，并返回字母时间轴：
        (wav_bytes, intro_duration_ms, letter_timeline)
    letter_timeline 条目：{"morse": str, "start_ms": float, "end_ms": float}
    调用方可据 tokens 顺序回填 letter 字段。
    """
    rng = np.random.default_rng(cfg.drum_seed)
    one_pass, intervals = build_morse_drum_timeline_with_letters(
        morse_dot_dash,
        float(cfg.bpm),
        cfg.sample_rate,
        rng,
        dash_ratio=float(cfg.dash_ratio),
        short_voice=short_voice,
        long_voice=long_voice,
    )
    one_pass = normalize_peak(one_pass)
    if pad_to_bar:
        one_pass, bar_count = _pad_to_bar_grid(one_pass, cfg.sample_rate, float(cfg.bpm))
        logger.info(
            "前奏鼓点：对齐小节后 %.2fs（约 %d 小节 @ BPM=%d，voices=%s/%s）",
            len(one_pass) / cfg.sample_rate,
            bar_count,
            cfg.bpm,
            short_voice,
            long_voice,
        )
    else:
        logger.info(
            "前奏鼓点：%.2fs（voices=%s/%s）",
            len(one_pass) / cfg.sample_rate,
            short_voice,
            long_voice,
        )
    intro_duration_ms = int(round(len(one_pass) * 1000.0 / cfg.sample_rate))
    wav_bytes = floats_to_wav_bytes_mono(one_pass, cfg.sample_rate)
    return wav_bytes, intro_duration_ms, intervals


def render_drum_reference(
    morse_dot_dash: str,
    cfg: DemoConfig,
    mp3_out: Path,
    wav_fallback: Optional[Path] = None,
) -> Path:
    """
    生成鼓点参考音频（优先 mp3），返回实际写入的路径。
    若 MP3 导出失败且提供 wav_fallback，则写入 WAV。
    """
    rng = np.random.default_rng(cfg.drum_seed)
    one_pass = build_morse_drum_timeline(
        morse_dot_dash,
        float(cfg.bpm),
        cfg.sample_rate,
        rng,
        dash_ratio=float(cfg.dash_ratio),
    )
    one_pass = normalize_peak(one_pass)
    looped = _loop_to_duration(
        one_pass, cfg.sample_rate, cfg.drum_target_min_sec, cfg.drum_target_max_sec
    )
    looped, bar_count = _pad_to_bar_grid(looped, cfg.sample_rate, float(cfg.bpm))
    dur = len(looped) / cfg.sample_rate
    logger.info(
        "鼓点时间线：单遍 %.2fs，循环对齐后 %.2fs（约 %d 小节 @ BPM=%d，dash_ratio=%.1f）",
        len(one_pass) / cfg.sample_rate,
        dur,
        bar_count,
        cfg.bpm,
        cfg.dash_ratio,
    )

    wav_bytes = floats_to_wav_bytes_mono(looped, cfg.sample_rate)
    try:
        save_mp3_from_wav_bytes(wav_bytes, mp3_out, bitrate=cfg.output_bitrate)
        logger.info("已写入鼓点 MP3：%s", mp3_out)
        return mp3_out
    except Exception as e:
        logger.warning("MP3 导出失败（%s），尝试写入 WAV 兜底。", e)
        if wav_fallback is None:
            raise
        save_wav(wav_fallback, looped, cfg.sample_rate)
        logger.info("已写入鼓点 WAV：%s", wav_fallback)
        return wav_fallback


# =========================================================
# 音高化摩斯 hook：把点划映射为「调式内的旋律动机」，贯穿全曲
# 目标：像碟中谍那样有记忆点、能哼出来，而不只是无音高鼓点
# =========================================================

_NOTE_SEMITONES: dict[str, int] = {
    "C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4,
    "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8, "AB": 8, "A": 9,
    "A#": 10, "BB": 10, "B": 11,
}

# 音阶（相对根音的半音偏移）；hook 用五声/小调更「东方/电影」，major 更明亮
SCALES: dict[str, list[int]] = {
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor_pent": [0, 3, 5, 7, 10],
    "major_pent": [0, 2, 4, 7, 9],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
}


def _note_freq(root_note: str = "A", octave: int = 4, semitone_offset: int = 0) -> float:
    """根音名 + 八度 + 半音偏移 → 频率(Hz)。A4=440。"""
    base = _NOTE_SEMITONES.get(root_note.upper(), 9)
    midi = 12 * (octave + 1) + base + semitone_offset
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def _synth_hook_note(freq: float, duration_sec: float, sr: int, *, timbre: str = "pluck") -> np.ndarray:
    """带音高的乐音：柔和起音 + 指数衰减 + 少量泛音。

    默认曲里这层会叠在 AI 音乐上；过硬的 attack 会像“后贴敲击音效”。
    因此这里刻意把起音/收音做得更圆润，让摩斯更像歌曲内部的 motif。
    """
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    if timbre == "bell":
        attack_sec = 0.032
        decay = np.exp(-t * 3.0)
        tone = (
            np.sin(2 * np.pi * freq * t)
            + 0.5 * np.sin(2 * np.pi * freq * 2.01 * t)
            + 0.25 * np.sin(2 * np.pi * freq * 3.86 * t)
        )
    elif timbre == "piano":
        attack_sec = 0.018
        decay = np.exp(-t * 4.2)
        tone = (
            np.sin(2 * np.pi * freq * t)
            + 0.45 * np.sin(2 * np.pi * freq * 2 * t)
            + 0.2 * np.sin(2 * np.pi * freq * 3 * t)
            + 0.08 * np.sin(2 * np.pi * freq * 4 * t)
        )
    else:  # pluck / music-box
        attack_sec = 0.020
        decay = np.exp(-t * 6.0)
        tone = (
            np.sin(2 * np.pi * freq * t)
            + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
            + 0.12 * np.sin(2 * np.pi * freq * 3 * t)
        )
    attack = np.sin(np.clip(t / attack_sec, 0.0, 1.0) * (np.pi / 2.0)) ** 2
    release_len = min(n, max(1, int(0.080 * sr)))
    release = np.ones(n, dtype=np.float64)
    release[-release_len:] = np.cos(np.linspace(0.0, np.pi / 2.0, release_len)) ** 2
    x = (attack * release * decay * tone).astype(np.float32)
    return _norm(x, 0.62)


def build_morse_hook(
    morse_dot_dash: str,
    bpm: float,
    sr: int,
    *,
    root: str = "A",
    scale: str = "minor_pent",
    octave: int = 4,
    dash_ratio: float = 2.0,
    timbre: str = "pluck",
) -> tuple[np.ndarray, list[dict], int]:
    """
    把「空格分字母」的摩斯串合成为调式内的旋律动机（mono float32）。

    设计：
    - 点(·) = 八分音符短音，沿音阶级进上行（chattering 感）；
    - 划(−) = dash_ratio 倍时长的长音，落在和弦音(根/三/五)上（锚定感）；
    - 每个字母开头把旋律指针复位到根音，形成可辨识的结构；
    - 字母之间留半个八分的呼吸。

    Returns:
        (waveform, note_timeline, total_ms)
        note_timeline 条目：{"letter":"", "morse": token, "freq": hz,
                             "start_ms": float, "end_ms": float, "is_dash": bool}
    """
    scale_steps = SCALES.get(scale, SCALES["minor_pent"])
    beat = 60.0 / max(1.0, float(bpm))
    dt_dot = beat / 2.0  # 八分音符
    dt_dash = dt_dot * max(1.0, float(dash_ratio))

    tokens = morse_dot_dash.split()
    placed: list[tuple[int, np.ndarray]] = []  # (start_sample, wave)
    note_timeline: list[dict] = []
    cursor = 0.0  # 秒

    for ti, token in enumerate(tokens):
        idx = 0  # 每字母复位到根音
        for sym in token:
            if sym == ".":
                deg = scale_steps[idx % len(scale_steps)]
                dur = dt_dot
                is_dash = False
            elif sym == "-":
                chord_idx = [0, 2, 4][idx % 3]
                deg = scale_steps[chord_idx % len(scale_steps)]
                dur = dt_dash
                is_dash = True
            else:
                continue
            freq = _note_freq(root, octave, deg)
            wave = _synth_hook_note(freq, dur, sr, timbre=timbre)
            start_sample = int(round(cursor * sr))
            placed.append((start_sample, wave))
            note_timeline.append(
                {
                    "letter": "",
                    "morse": token,
                    "freq": round(freq, 2),
                    "start_ms": round(cursor * 1000.0, 1),
                    "end_ms": round((cursor + dur) * 1000.0, 1),
                    "is_dash": is_dash,
                }
            )
            cursor += dur
            idx += 1
        if ti < len(tokens) - 1:
            cursor += dt_dot * 0.5  # 字母间呼吸

    total_sec = cursor if cursor > 0 else dt_dot
    total_samples = int(round(total_sec * sr))
    buf = np.zeros(total_samples + sr // 10, dtype=np.float32)  # 末尾余量给尾音
    for start_sample, wave in placed:
        end = start_sample + wave.shape[0]
        if end > buf.shape[0]:
            wave = wave[: buf.shape[0] - start_sample]
            end = buf.shape[0]
        buf[start_sample:end] += wave
    buf = normalize_peak(buf, headroom_db=2.0)
    total_ms = int(round(total_sec * 1000.0))
    return buf, note_timeline, total_ms


def render_morse_hook_with_timeline(
    morse_dot_dash: str,
    cfg: DemoConfig,
    *,
    root: str = "A",
    scale: str = "minor_pent",
    octave: int = 4,
    dash_ratio: float = 2.0,
    timbre: str = "pluck",
    bpm: Optional[float] = None,
) -> tuple[np.ndarray, list[dict], int]:
    """便捷封装：用给定 BPM（默认 cfg.bpm）合成一遍 hook 动机，返回浮点波形。"""
    use_bpm = float(bpm) if bpm else float(cfg.bpm)
    return build_morse_hook(
        morse_dot_dash,
        use_bpm,
        cfg.sample_rate,
        root=root,
        scale=scale,
        octave=octave,
        dash_ratio=dash_ratio,
        timbre=timbre,
    )

