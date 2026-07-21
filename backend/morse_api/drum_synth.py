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


# 真实乐器 timbre / 架子鼓套件 → 前端视觉特效原型。
# 关键：前端点划特效必须跟「实际听到的摩斯动机音色」对应，而不是旧的鼓点音色。
# 视觉原型（见 App.jsx CSS）：
#   bloom —— 柔和泛起+金色光晕缓收（钢琴/电钢/竖琴等有延音的键盘弦乐，余韵柔和）
#   pluck —— 横向抖动+余震（拨弦类：古筝/吉他/拨奏，颗粒弹性）
#   crisp —— 极短一闪（清脆短促：木琴/八音盒/拨奏短音）
#   hit   —— 砸落+同心金环涟漪（打击冲击：架子鼓底鼓/军鼓）
_TIMBRE_EFFECT_MAP: dict[str, str] = {
    # 键盘/延音类 → bloom（柔和光晕，配延音余韵）
    "piano": "bloom",
    "epiano": "bloom",
    "epiano-fm": "bloom",
    "celeste": "bloom",
    "harp": "bloom",
    "vibraphone": "bloom",     # 颤音琴金属余韵长，光晕更贴切
    "tubular-bells": "bloom",  # 管钟宏大绵长
    "bell": "bloom",
    "kalimba": "bloom",        # 卡林巴清脆但有余韵，柔和泛起
    # 拨弦类 → pluck（横向抖动+余震，贴合拨弦颗粒感）
    "koto": "pluck",
    "guitar": "pluck",
    "jazz-guitar": "pluck",
    "pluck": "pluck",
    "harpsichord": "pluck",
    "dulcimer": "pluck",       # 扬琴击弦，颗粒清晰
    "pizzicato": "pluck",
    "steel-drums": "pluck",
    # 清脆短促类 → crisp（极短一闪，无余韵拖尾的明亮点）
    "music-box": "crisp",
    "xylophone": "crisp",
    "marimba": "crisp",
}


def effect_for_hook(style) -> tuple[str, str]:
    """按风格「实际的摩斯动机音色/形态」返回 (dot_effect, dash_effect)。

    点(短)与划(长)用「有区分度」的特效，贴合摩斯点划语义、也贴合真实听感：
    - 旋律动机(melodic)：
        · 拨弦类(古筝/吉他/拨奏) → 点=pluck(短抖动)、划=bloom(长音柔和延展)
        · 键盘/延音/清脆类       → 点=crisp(短促一闪)、划=bloom(长音光晕延展)
      —— 划都落到 bloom，天然表现「长音余韵铺开」，与点的短促形成对比。
    - 节奏动机(percussive，架子鼓)：点=crisp(踩镲一闪)、划=hit(底鼓/军鼓砸落涟漪)，
      正好对应实际鼓件（点打闭镲、划打底鼓+军鼓）。

    取代旧的 effect_for_voice(drum_voices)——那套跟的是已不再演奏的鼓点音色，
    与真实听感脱节（如古筝却给木鱼 crisp+堂鼓 hit）。
    """
    if getattr(style, "hook_kind", "melodic") == "percussive":
        # 架子鼓：点=踩镲一闪(crisp)、划=底鼓军鼓砸落(hit)，与鼓件一一对应
        return "crisp", "hit"
    timbre = getattr(style, "hook_timbre", "piano")
    base = _TIMBRE_EFFECT_MAP.get(timbre, "bloom")
    if base == "pluck":
        # 拨弦类：点保留拨弦抖动，划用 bloom 表现长音延展
        return "pluck", "bloom"
    # 键盘/延音/清脆类：点用 crisp 短促、划用 bloom 长音光晕，形成长短对比
    return "crisp", "bloom"


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


def _note_midi(root_note: str = "A", octave: int = 4, semitone_offset: int = 0) -> int:
    """根音名 + 八度 + 半音偏移 → MIDI 音符号（60=C4）。供 SoundFont 演奏。"""
    base = _NOTE_SEMITONES.get(root_note.upper(), 9)
    return 12 * (octave + 1) + base + semitone_offset


# 把项目内的 hook_timbre 映射到 GeneralUser GS 音源里的 General MIDI 乐器编号。
# 用真实采样乐器替代此前手搓的合成器波形，音色真实很多。
_TIMBRE_TO_GM_PROGRAM: dict[str, int] = {
    "piano": 0,          # Grand Piano（原有）
    "pluck": 24,         # Nylon Guitar 尼龙拨弦（原有）
    "guitar": 25,        # Steel Guitar 钢弦吉他（原有）
    "harp": 46,          # Orchestral Harp 竖琴（原有）
    "music-box": 10,     # Music Box 八音盒（原有）
    "bell": 9,           # Glockenspiel 钟琴（原有）
    # —— 新增：同为「敲击/拨弦后自然衰减」型，音源采样质量好、延音逻辑通用 ——
    "epiano": 4,         # Tine Electric Piano 电钢（Rhodes 感，温暖圆润）
    "epiano-fm": 5,      # FM Electric Piano（DX 电钢，清透）
    "harpsichord": 6,    # Harpsichord 羽管键琴（古典拨弦键盘）
    "celeste": 8,        # Celeste 钢片琴（梦幻清亮）
    "vibraphone": 11,    # Vibraphone 颤音琴（爵士金属，余韵长）
    "marimba": 12,       # Marimba 马林巴（木质温暖）
    "xylophone": 13,     # Xylophone 木琴（明亮干脆）
    "tubular-bells": 14, # Tubular Bells 管钟（教堂钟，宏大绵长）
    "dulcimer": 15,      # Dulcimer 扬琴（击弦，东方感）
    "jazz-guitar": 26,   # Jazz Guitar 爵士吉他（圆润）
    "pizzicato": 45,     # Pizzicato Strings 弦乐拨奏（短促弹性）
    "koto": 107,         # Koto 日本筝（东方拨弦）
    "kalimba": 108,      # Kalimba 卡林巴拇指琴（清脆治愈）
    "steel-drums": 114,  # Steel Drums 钢鼓（加勒比金属，明亮）
}

# 各音色松键后的「延音尾巴」秒数：钢琴/拨弦/铃等属「击弦(敲击)后自然衰减」型乐器，
# 松开琴键后声音应自然拖尾衰减，而不是瞬间切断（否则听感"戛然而止"很假、不丝滑）。
# 做法：把 noteoff 延后到「名义结束 + 此尾巴」，让短音也余音绕梁、相邻音自然交叠
# （类似轻踩延音踏板）。值越大→余音越长、交叠越多（越连贯，但过大会糊）。
_TIMBRE_SUSTAIN_TAIL_SEC: dict[str, float] = {
    "piano": 1.4,       # 钢琴：延音较长，营造持续、不戛然而止的真实感
    "bell": 2.0,        # 钟琴：金属余韵最长
    "music-box": 1.8,   # 八音盒：清脆但余音绕梁
    "pluck": 0.8,       # 尼龙拨弦：衰减较快
    "guitar": 0.9,      # 钢弦吉他
    "harp": 1.2,        # 竖琴：泛音绵长
    # —— 新增乐器的自然延音（按各乐器真实衰减特性设定）——
    "epiano": 1.6,       # 电钢：Rhodes 音叉余韵温暖绵长
    "epiano-fm": 1.4,    # FM 电钢：清透，中等延音
    "harpsichord": 0.7,  # 羽管键琴：拨弦短促
    "celeste": 1.8,      # 钢片琴：清亮余韵长
    "vibraphone": 2.2,   # 颤音琴：金属片震荡最久
    "marimba": 1.0,      # 马林巴：木质，衰减适中
    "xylophone": 0.6,    # 木琴：明亮干脆，短促
    "tubular-bells": 3.0,# 管钟：教堂钟余韵极长
    "dulcimer": 1.5,     # 扬琴：击弦金属余韵
    "jazz-guitar": 1.0,  # 爵士吉他：圆润
    "pizzicato": 0.5,    # 弦乐拨奏：短促弹性
    "koto": 1.3,         # 日本筝：拨弦泛音绵长
    "kalimba": 1.4,      # 卡林巴：清脆带余韵
    "steel-drums": 1.2,  # 钢鼓：金属明亮
}

# SoundFont 单例缓存：sf2 只加载一次，避免每次生成重复读 32MB 文件
_SF2_PATH = PACKAGE_DIR_SOUNDFONT = (Path(__file__).resolve().parent / "soundfonts" / "gu.sf2")
_SF2_SYNTH_CACHE: dict = {}


def _get_sf2_synth(sr: int):
    """惰性加载 SoundFont 合成器（按采样率缓存）。sf2 缺失或库不可用时返回 None → 调用方回退手搓合成。"""
    if not _SF2_PATH.is_file():
        return None
    key = int(sr)
    if key in _SF2_SYNTH_CACHE:
        return _SF2_SYNTH_CACHE[key]
    try:
        import tinysoundfont  # 纯 pip、自带渲染引擎，无需系统 C 库
        syn = tinysoundfont.Synth(samplerate=sr, gain=1.0)
        sfid = syn.sfload(str(_SF2_PATH))
        _SF2_SYNTH_CACHE[key] = (syn, sfid)
        return _SF2_SYNTH_CACHE[key]
    except Exception as e:  # noqa: BLE001
        logger.warning("SoundFont 加载失败，回退手搓合成：%s", e)
        _SF2_SYNTH_CACHE[key] = None
        return None


def _render_notes_sf2(
    events: list[tuple[float, float, int]],
    total_sec: float,
    sr: int,
    *,
    timbre: str,
) -> Optional[np.ndarray]:
    """用真实采样音源(SoundFont)把音符事件渲染成单声道 float32 波形。

    events: [(start_sec, dur_sec, midi_note), ...]
    返回 None 表示音源不可用（调用方应回退到手搓合成）。
    做法：按时间推进，逐帧 noteon/noteoff，一次性 generate 整段（含尾音余量），
          再从立体声交织缓冲取出并转单声道。
    """
    got = _get_sf2_synth(sr)
    if got is None:
        return None
    syn, sfid = got
    program = _TIMBRE_TO_GM_PROGRAM.get(timbre, 0)
    sustain_tail = _TIMBRE_SUSTAIN_TAIL_SEC.get(timbre, 1.2)
    try:
        # 复位并选好音色
        syn.sounds_off(0)
        syn.program_select(0, sfid, 0, program)
        # 尾音余量：留足最后一个音「松键后自然衰减」的时间，避免整段结尾被切
        tail = max(1.2, sustain_tail + 0.5)
        total_frames = int(round((total_sec + tail) * sr))

        # 构造「帧位置 -> 动作」列表：on/off。
        # 关键：noteoff 不再压在名义时长的 92% 处（那会让钢琴"戛然而止"），
        # 而是延后到「音符结束 + sustain_tail」，让声音自然拖尾衰减、相邻音自然交叠，
        # 听感像真钢琴松键后余音绕梁（近似轻踩延音踏板），更连贯丝滑。
        # 陷阱：同一音高若前音的延后 off 落在后一个同音 on 之后，会把后音误掐断；
        #      故对同音高，把前音的 off 收紧到「下一次同音 on 之前一点」。
        raw_notes: list[tuple[int, int, int]] = []  # (on_frame, off_frame, note)
        for start_sec, dur_sec, note in events:
            on = int(round(start_sec * sr))
            off = int(round((start_sec + max(0.05, dur_sec) + sustain_tail) * sr))
            raw_notes.append((on, off, note))
        raw_notes.sort(key=lambda x: x[0])

        # 同音高去冲突：后一个同音 on 之前 20ms 强制松开前一个同音，避免误杀后音。
        # 反向遍历记录「每个音后续同音的最近 on」，据此夹紧当前音的 off。
        guard = int(round(0.02 * sr))
        seen_next: dict[int, int] = {}
        clamped: list[tuple[int, int, int]] = []
        for on, off, note in reversed(raw_notes):
            nxt_same = seen_next.get(note)
            if nxt_same is not None:
                off = min(off, nxt_same - guard)
            off = max(on + int(round(0.05 * sr)), off)  # 至少发声 50ms
            clamped.append((on, off, note))
            seen_next[note] = on
        clamped.reverse()

        actions: list[tuple[int, str, int]] = []
        for on, off, note in clamped:
            actions.append((on, "on", note))
            actions.append((off, "off", note))
        actions.sort(key=lambda a: a[0])

        out = np.zeros(total_frames, dtype=np.float32)
        cur = 0
        ai = 0
        # 逐段推进：在每个动作点之间 generate 对应帧数
        while cur < total_frames:
            # 处理落在当前帧的所有动作
            while ai < len(actions) and actions[ai][0] <= cur:
                _, kind, note = actions[ai]
                if kind == "on":
                    syn.noteon(0, note, 105)
                else:
                    syn.noteoff(0, note)
                ai += 1
            nxt = actions[ai][0] if ai < len(actions) else total_frames
            nxt = min(nxt, total_frames)
            nframes = max(1, nxt - cur)
            raw = np.frombuffer(bytes(syn.generate(nframes)), dtype=np.float32)
            # 立体声交织 -> 单声道
            if raw.size >= nframes * 2:
                mono = (raw[0:nframes * 2:2] + raw[1:nframes * 2:2]) * 0.5
            else:
                mono = raw[:nframes]
            end = min(total_frames, cur + mono.shape[0])
            out[cur:end] += mono[: end - cur]
            cur = nxt
        return normalize_peak(out, headroom_db=2.0)
    except Exception as e:  # noqa: BLE001
        logger.warning("SoundFont 渲染失败，回退手搓合成：%s", e)
        return None


# =========================================================
# 真实架子鼓（SoundFont GM 打击乐组，bank=128）
# 与旋律乐器不同：鼓组在专用通道，音符号=鼓件（而非音高）。
# GM 标准鼓件音符号（General MIDI Percussion Key Map）：
# =========================================================
_GM_DRUM = {
    "kick": 36,        # Bass Drum 1（底鼓）
    "kick2": 35,       # Acoustic Bass Drum
    "snare": 38,       # Acoustic Snare（军鼓）
    "snare_rim": 40,   # Electric Snare
    "side_stick": 37,  # Side Stick（鼓边敲）
    "hat_closed": 42,  # Closed Hi-Hat（闭合踩镲）
    "hat_open": 46,    # Open Hi-Hat（开放踩镲）
    "hat_pedal": 44,   # Pedal Hi-Hat
    "tom_low": 45,     # Low Tom
    "tom_mid": 47,     # Low-Mid Tom
    "tom_high": 50,    # High Tom
    "crash": 49,       # Crash Cymbal 1（碎音镲）
    "ride": 51,        # Ride Cymbal 1（叮叮镲）
}

# 摩斯 → 鼓件映射方案：点(·)打轻件（踩镲/鼓边），划(−)打重件（底鼓+军鼓），
# 每个字母首拍加一记底鼓做「重音锚点」，让点划分组可辨。
_DRUM_PATTERNS: dict[str, dict] = {
    # 标准套件：点=闭镲，划=底鼓+军鼓
    "standard": {"dot": ["hat_closed"], "dash": ["kick", "snare"], "accent": ["kick"]},
    # 律动套件：点=闭镲，划=军鼓，重音=底鼓+碎音
    "groove":   {"dot": ["hat_closed"], "dash": ["snare"], "accent": ["kick", "crash"]},
    # 轻质套件：点=鼓边，划=Tom，适合安静风格
    "brushed":  {"dot": ["side_stick"], "dash": ["tom_low"], "accent": ["kick2"]},
}

# 各鼓件「松键前的持续时长」秒数：真实架子鼓不同鼓件的自然衰减差异很大——
# 镲片(踩镲/碎音/Ride)敲击后会自然震荡拖尾一段时间，若像之前那样一律 60ms 就松键，
# 会把镲片的自然尾音切掉，听感发硬、不自然；而底鼓/军鼓/Tom 本就短促，无需长尾。
# 按鼓件给不同延音，让镲片余韵自然、鼓身干净利落。
_DRUM_NOTE_SUSTAIN_SEC: dict[int, float] = {
    42: 0.18,   # Closed Hi-Hat 闭合踩镲：短促但保留一点"嗤"尾
    44: 0.18,   # Pedal Hi-Hat
    46: 0.55,   # Open Hi-Hat 开放踩镲：尾音较长
    49: 1.30,   # Crash 碎音镲：金属长尾，最需要余韵
    51: 1.10,   # Ride 叮叮镲：绵长
    36: 0.14,   # Bass Drum 底鼓：干净短促
    35: 0.14,   # Acoustic Bass Drum
    38: 0.20,   # Snare 军鼓：短促带一点余震
    40: 0.20,   # Electric Snare
    37: 0.10,   # Side Stick 鼓边：极短
    45: 0.30,   # Low Tom
    47: 0.30,   # Low-Mid Tom
    50: 0.28,   # High Tom
}
_DRUM_DEFAULT_SUSTAIN_SEC = 0.20


def _render_drumkit_sf2(
    events: list[tuple[float, list[int], int]],
    total_sec: float,
    sr: int,
    *,
    drum_bank: int = 128,
    drum_preset: int = 0,
) -> Optional[np.ndarray]:
    """用真实采样鼓组(SoundFont bank=128)把「鼓点事件」渲染成单声道 float32。

    events: [(start_sec, [鼓件音符号...], velocity), ...]
        —— 同一时刻可同时敲多个鼓件（如底鼓+军鼓）。
    鼓件是「一击即衰」的打击乐，noteon 后很快 noteoff（鼓组多为 one-shot 采样）。
    返回 None 表示音源不可用（调用方回退到手搓合成鼓点）。
    """
    got = _get_sf2_synth(sr)
    if got is None:
        return None
    syn, sfid = got
    try:
        ch = 9  # 习惯上第 10 通道(索引9)为鼓组通道
        syn.sounds_off(ch)
        # 鼓组在 bank 128；若该 preset 不存在，program_select 可能抛错 → 交给外层回退
        syn.program_select(ch, sfid, drum_bank, drum_preset)
        tail = 1.8  # 碎音镲尾音最长可达 1.3s，留足余量避免整段结尾被切
        total_frames = int(round((total_sec + tail) * sr))

        # 构造动作序列：每个鼓件击打 = 一次 on，再按「该鼓件的自然延音」后 off。
        # 关键：不再一律 60ms 硬切（那会切掉镲片自然尾音、听感发硬），
        # 镲片(踩镲/碎音/Ride)保留长尾余韵，底鼓/军鼓/Tom 干净短促。
        actions: list[tuple[int, str, int, int]] = []  # (frame, kind, note, vel)
        for start_sec, notes, vel in events:
            on = int(round(start_sec * sr))
            for note in notes:
                sus = _DRUM_NOTE_SUSTAIN_SEC.get(note, _DRUM_DEFAULT_SUSTAIN_SEC)
                off = on + int(round(sus * sr))
                actions.append((on, "on", note, vel))
                actions.append((off, "off", note, vel))
        actions.sort(key=lambda a: a[0])

        out = np.zeros(total_frames, dtype=np.float32)
        cur = 0
        ai = 0
        while cur < total_frames:
            while ai < len(actions) and actions[ai][0] <= cur:
                _, kind, note, vel = actions[ai]
                if kind == "on":
                    syn.noteon(ch, note, vel)
                else:
                    syn.noteoff(ch, note)
                ai += 1
            nxt = actions[ai][0] if ai < len(actions) else total_frames
            nxt = min(nxt, total_frames)
            nframes = max(1, nxt - cur)
            raw = np.frombuffer(bytes(syn.generate(nframes)), dtype=np.float32)
            if raw.size >= nframes * 2:
                mono = (raw[0:nframes * 2:2] + raw[1:nframes * 2:2]) * 0.5
            else:
                mono = raw[:nframes]
            end = min(total_frames, cur + mono.shape[0])
            out[cur:end] += mono[: end - cur]
            cur = nxt
        return normalize_peak(out, headroom_db=2.0)
    except Exception as e:  # noqa: BLE001
        logger.warning("SoundFont 鼓组渲染失败，回退手搓合成：%s", e)
        return None


def _karplus_strong(freq: float, dur_sec: float, sr: int, *, decay: float = 0.996, blend: float = 1.0) -> np.ndarray:
    """Karplus-Strong 物理拨弦模型：拨弦/吉他/竖琴的黄金标准，听感非常真实。

    原理：用一段白噪声激励填充延迟线（弦长 = sr/freq），
    每次循环取相邻两抽头平均（低通）再乘衰减系数写回——
    高频泛音天然比低频衰减更快，产生真实的"越振越暗"音色，无需手工堆泛音。
    """
    n = max(1, int(dur_sec * sr))
    N = max(2, int(round(sr / max(1e-6, freq))))  # 延迟线长度决定基频
    rng = np.random.default_rng(int(freq * 100) & 0xFFFFFFFF)  # 频率播种，保证可复现
    # 激励：带轻微低通的噪声（真实拨弦不是纯白噪声，高频略弱）
    exc = rng.uniform(-1.0, 1.0, size=N).astype(np.float64)
    exc = np.convolve(exc, [0.5, 0.5], mode="same")
    buf = exc.copy()
    out = np.empty(n, dtype=np.float64)
    idx = 0
    prev = 0.0
    for i in range(n):
        cur = buf[idx]
        out[i] = cur
        # 一阶低通反馈：blend 控制平均程度（拨弦=1.0），decay 控制余音长度
        nxt = decay * (blend * 0.5 * (cur + prev) + (1.0 - blend) * cur)
        buf[idx] = nxt
        prev = cur
        idx = (idx + 1) % N
    return out.astype(np.float32)


def _synth_hook_note(freq: float, duration_sec: float, sr: int, *, timbre: str = "pluck") -> np.ndarray:
    """带音高的乐音，力求接近真实乐器：

    - pluck/guitar/harp：Karplus-Strong 物理弦模型（真实拨弦，泛音随时间自然变暗）；
    - piano：多个"非谐波"泛音，各自独立衰减（高频先消失）+ 琴槌敲击瞬态；
    - bell/music-box：非谐波金属泛音 + 慢衰减，金属质感。

    共同点：加入起音瞬态噪声（真实乐器的"触发"声）与圆润的 attack/release 包络，
    让摩斯 motif 听起来像"被演奏出来"而非合成器蜂鸣。
    """
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr

    if timbre in ("pluck", "guitar", "harp", "music-box"):
        # 物理弦：长音余韵更足，短音更干脆
        decay_coef = 0.9975 if duration_sec > 0.35 else 0.994
        body = _karplus_strong(freq, duration_sec, sr, decay=decay_coef, blend=1.0).astype(np.float64)
        # 拨弦瞬态：极短的宽带"chiff"，让触弦真实
        tr_len = min(n, max(1, int(0.006 * sr)))
        rng = np.random.default_rng((int(freq) * 7 + 13) & 0xFFFFFFFF)
        transient = np.zeros(n, dtype=np.float64)
        transient[:tr_len] = rng.uniform(-1.0, 1.0, size=tr_len) * np.linspace(1.0, 0.0, tr_len)
        x = body + 0.18 * transient
        attack_sec = 0.004
    elif timbre == "piano":
        # 钢琴：非谐波泛音（微微偏离整数倍）+ 每个泛音独立衰减速率（高频衰减更快）
        partials = [
            (1.0, 1.00, 3.2),   # (相对振幅, 频率倍数, 衰减速率)
            (0.55, 2.003, 5.0),
            (0.32, 3.008, 7.5),
            (0.18, 4.017, 10.0),
            (0.09, 5.03, 13.0),
        ]
        x = np.zeros(n, dtype=np.float64)
        for amp, mult, dec in partials:
            x += amp * np.exp(-t * dec) * np.sin(2 * np.pi * freq * mult * t)
        # 琴槌敲击瞬态（很短的噪声 attack）
        tr_len = min(n, max(1, int(0.005 * sr)))
        rng = np.random.default_rng((int(freq) * 11 + 5) & 0xFFFFFFFF)
        x[:tr_len] += 0.35 * rng.uniform(-1.0, 1.0, size=tr_len) * np.linspace(1.0, 0.0, tr_len)
        attack_sec = 0.006
    else:  # bell
        # 铃/钟：明显非谐波的金属泛音（含 2.76、5.40 等钟体模态），慢衰减
        partials = [
            (1.0, 1.00, 1.6),
            (0.6, 2.76, 2.0),
            (0.4, 5.40, 2.6),
            (0.25, 8.93, 3.4),
        ]
        x = np.zeros(n, dtype=np.float64)
        for amp, mult, dec in partials:
            x += amp * np.exp(-t * dec) * np.sin(2 * np.pi * freq * mult * t)
        attack_sec = 0.004

    # 圆润 attack（sin² 起音）+ 尾部 release（cos² 收音），消除咔哒声
    attack = np.sin(np.clip(t / attack_sec, 0.0, 1.0) * (np.pi / 2.0)) ** 2
    release_len = min(n, max(1, int(0.070 * sr)))
    release = np.ones(n, dtype=np.float64)
    release[-release_len:] = np.cos(np.linspace(0.0, np.pi / 2.0, release_len)) ** 2
    x = (attack * release * x).astype(np.float32)
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
    sf2_events: list[tuple[float, float, int]] = []  # (start_sec, dur_sec, midi) 供 SoundFont 演奏
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
            sf2_events.append((cursor, dur, _note_midi(root, octave, deg)))
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
    total_ms = int(round(total_sec * 1000.0))

    # 优先用真实采样音源(SoundFont)演奏；不可用时回退到手搓合成波形
    sf2_wave = _render_notes_sf2(sf2_events, total_sec, sr, timbre=timbre)
    if sf2_wave is not None:
        return sf2_wave, note_timeline, total_ms

    total_samples = int(round(total_sec * sr))
    buf = np.zeros(total_samples + sr // 10, dtype=np.float32)  # 末尾余量给尾音
    for start_sample, wave in placed:
        end = start_sample + wave.shape[0]
        if end > buf.shape[0]:
            wave = wave[: buf.shape[0] - start_sample]
            end = buf.shape[0]
        buf[start_sample:end] += wave
    buf = normalize_peak(buf, headroom_db=2.0)
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


def build_morse_drumkit(
    morse_dot_dash: str,
    bpm: float,
    sr: int,
    *,
    dash_ratio: float = 2.0,
    kit: str = "standard",
    drum_preset: int = 0,
    velocity: int = 115,
) -> tuple[np.ndarray, list[dict], int]:
    """把摩斯点划用「真实采样架子鼓」打成一段鼓点动机（mono float32）。

    与 build_morse_hook 平行，但输出的是打击乐而非旋律：
    - 点(·) = 八分音符位置敲轻件（默认闭合踩镲）；
    - 划(−) = dash_ratio 倍时长起点敲重件（默认底鼓+军鼓）；
    - 每个字母的第一击叠一记「重音件」(accent，默认底鼓)，让字母分组可辨；
    - 字母之间留半个八分的呼吸。

    kit: _DRUM_PATTERNS 的键（standard / groove / brushed）。
    drum_preset: SoundFont bank128 里的鼓组 preset（0=Standard Kit）。

    Returns:
        (waveform, note_timeline, total_ms)，note_timeline 结构与 hook 对齐，
        便于前端用同一套逐音符高亮逻辑。
    """
    pattern = _DRUM_PATTERNS.get(kit, _DRUM_PATTERNS["standard"])
    dot_notes = [_GM_DRUM[n] for n in pattern["dot"]]
    dash_notes = [_GM_DRUM[n] for n in pattern["dash"]]
    accent_notes = [_GM_DRUM[n] for n in pattern["accent"]]

    beat = 60.0 / max(1.0, float(bpm))
    dt_dot = beat / 2.0  # 八分音符
    dt_dash = dt_dot * max(1.0, float(dash_ratio))

    tokens = morse_dot_dash.split()
    events: list[tuple[float, list[int], int]] = []  # (start_sec, [鼓件音符号], vel)
    note_timeline: list[dict] = []
    cursor = 0.0

    for ti, token in enumerate(tokens):
        first_in_letter = True
        for sym in token:
            if sym == ".":
                notes = list(dot_notes)
                dur = dt_dot
                is_dash = False
            elif sym == "-":
                notes = list(dash_notes)
                dur = dt_dash
                is_dash = True
            else:
                continue
            # 字母首击叠加重音件（底鼓/碎音），强调字母边界；用更高力度
            if first_in_letter:
                for a in accent_notes:
                    if a not in notes:
                        notes.append(a)
                vel = min(127, velocity + 10)
                first_in_letter = False
            else:
                vel = velocity
            events.append((cursor, notes, vel))
            note_timeline.append(
                {
                    "letter": "",
                    "morse": token,
                    "freq": 0.0,  # 鼓点无音高
                    "start_ms": round(cursor * 1000.0, 1),
                    "end_ms": round((cursor + dur) * 1000.0, 1),
                    "is_dash": is_dash,
                }
            )
            cursor += dur
        if ti < len(tokens) - 1:
            cursor += dt_dot * 0.5  # 字母间呼吸

    total_sec = cursor if cursor > 0 else dt_dot
    total_ms = int(round(total_sec * 1000.0))

    # 真实采样鼓组渲染；不可用时回退到手搓合成鼓点（VOICE_REGISTRY）
    kit_wave = _render_drumkit_sf2(events, total_sec, sr, drum_preset=drum_preset)
    if kit_wave is not None:
        return kit_wave, note_timeline, total_ms

    # ---- 回退：用手搓合成鼓件拼一段（音色偏假，仅在无 SoundFont 时兜底）----
    logger.info("架子鼓回退到手搓合成（SoundFont 不可用）")
    rng = np.random.default_rng(20260719)
    total_samples = int(round(total_sec * sr))
    buf = np.zeros(total_samples + sr // 2, dtype=np.float32)
    for start_sec, notes, _vel in events:
        start = int(round(start_sec * sr))
        # 简单映射：含底鼓→kick，含军鼓/踩镲→snare/hihat
        hit = np.zeros(1, dtype=np.float32)
        if _GM_DRUM["kick"] in notes or _GM_DRUM["kick2"] in notes:
            hit = _synth_kick_hit(0.18, sr)
        elif _GM_DRUM["snare"] in notes or _GM_DRUM["tom_low"] in notes:
            hit = _synth_snare_hit(rng, 0.12, sr)
        else:
            hit = _hihat_short(rng, 0.06, sr)
        end = min(buf.shape[0], start + hit.shape[0])
        if end > start:
            buf[start:end] += hit[: end - start]
    buf = normalize_peak(buf, headroom_db=2.0)
    return buf, note_timeline, total_ms


def render_morse_drumkit_with_timeline(
    morse_dot_dash: str,
    cfg: DemoConfig,
    *,
    dash_ratio: float = 2.0,
    kit: str = "standard",
    drum_preset: int = 0,
    bpm: Optional[float] = None,
) -> tuple[np.ndarray, list[dict], int]:
    """便捷封装：用给定 BPM（默认 cfg.bpm）把摩斯打成真实采样架子鼓鼓点。"""
    use_bpm = float(bpm) if bpm else float(cfg.bpm)
    return build_morse_drumkit(
        morse_dot_dash,
        use_bpm,
        cfg.sample_rate,
        dash_ratio=dash_ratio,
        kit=kit,
        drum_preset=drum_preset,
    )

