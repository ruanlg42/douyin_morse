"""
beat_align.py — 用 librosa 探测 AI 成品的真实 BPM / 拍点 / 主调，
并把「摩斯 hook」事件吸附到最近的节拍网格，实现后期对齐。

设计原则：
- librosa 是可选依赖。未安装或探测失败时，全部函数「优雅降级」，
  返回 prompt 指定 / 传入的 BPM，不阻断主流程。
- 只做「微调修正」，不强行相信探测：探测 BPM 若与目标差异过大，回退目标 BPM。
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def _librosa():
    """惰性导入 librosa；不可用返回 None。"""
    try:
        import librosa  # type: ignore

        return librosa
    except Exception as e:  # noqa: BLE001
        logger.info("librosa 不可用，跳过节拍探测：%s", e)
        return None


# 主调半音 → 音名（用于 hook 定调）
_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl 大小调模板（用于估计成品主调）
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


class BeatInfo:
    """探测结果容器。"""

    def __init__(
        self,
        *,
        bpm: float,
        beat_times_ms: list[float],
        root: str,
        scale: str,
        detected: bool,
    ):
        self.bpm = bpm
        self.beat_times_ms = beat_times_ms
        self.root = root
        self.scale = scale
        self.detected = detected  # True=来自 librosa 探测；False=回退默认

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"BeatInfo(bpm={self.bpm:.1f}, beats={len(self.beat_times_ms)}, "
            f"key={self.root} {self.scale}, detected={self.detected})"
        )


def _mp3_bytes_to_mono(librosa, mp3_bytes: bytes, target_sr: int = 22050):
    """MP3 字节 → 单声道 float 波形（用 librosa/audioread 解码）。失败抛异常。"""
    y, sr = librosa.load(BytesIO(mp3_bytes), sr=target_sr, mono=True)
    return y, sr


def _estimate_key(librosa, y, sr) -> tuple[str, str]:
    """用 chroma + Krumhansl 模板估计主调，返回 (root_note, 'major'|'minor')。"""
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)
        if float(np.sum(chroma_mean)) <= 1e-9:
            return "A", "minor"
        chroma_mean = chroma_mean / np.sum(chroma_mean)
        best_corr = -2.0
        best_root = 0
        best_mode = "minor"
        for shift in range(12):
            rolled = np.roll(chroma_mean, -shift)
            maj = float(np.corrcoef(rolled, _MAJOR_PROFILE)[0, 1])
            minr = float(np.corrcoef(rolled, _MINOR_PROFILE)[0, 1])
            if maj > best_corr:
                best_corr, best_root, best_mode = maj, shift, "major"
            if minr > best_corr:
                best_corr, best_root, best_mode = minr, shift, "minor"
        return _PITCH_CLASSES[best_root], best_mode
    except Exception as e:  # noqa: BLE001
        logger.info("主调估计失败，用默认 A minor：%s", e)
        return "A", "minor"


def analyze_track(
    mp3_bytes: bytes,
    *,
    target_bpm: Optional[float] = None,
    bpm_tolerance: float = 0.45,
) -> BeatInfo:
    """
    探测成品的 BPM / 拍点 / 主调。

    Args:
        target_bpm: prompt 指定的目标 BPM；若探测值与其偏差超过 bpm_tolerance（比例），
                    则信任 target_bpm（避免 librosa 半速/倍速误判）。
    Returns:
        BeatInfo；librosa 不可用或失败时 detected=False，bpm 回退 target_bpm 或 100。
    """
    fallback_bpm = float(target_bpm) if target_bpm else 100.0
    lib = _librosa()
    if lib is None:
        return BeatInfo(
            bpm=fallback_bpm, beat_times_ms=[], root="A", scale="minor", detected=False
        )

    try:
        y, sr = _mp3_bytes_to_mono(lib, mp3_bytes)
        tempo, beat_frames = lib.beat.beat_track(y=y, sr=sr, units="frames")
        tempo = float(np.atleast_1d(tempo)[0])
        beat_times = lib.frames_to_time(beat_frames, sr=sr)
        beat_times_ms = [round(float(t) * 1000.0, 1) for t in beat_times]

        # tempo 无效（0/NaN/极端值）→ 回退到 target 或默认
        if not np.isfinite(tempo) or tempo <= 30 or tempo > 300:
            logger.info("探测 BPM=%.1f 无效，回退 %.1f。", tempo, fallback_bpm)
            tempo = fallback_bpm

        # 半/倍速修正：向 target_bpm 靠拢
        if target_bpm and tempo > 0:
            for factor in (0.5, 2.0):
                if abs(tempo * factor - target_bpm) < abs(tempo - target_bpm):
                    tempo *= factor
            rel = abs(tempo - target_bpm) / max(1.0, target_bpm)
            if rel > bpm_tolerance:
                logger.info(
                    "探测 BPM=%.1f 与目标 %.1f 偏差 %.0f%%，信任目标值。",
                    tempo, target_bpm, rel * 100,
                )
                tempo = float(target_bpm)

        root, scale = _estimate_key(lib, y, sr)
        info = BeatInfo(
            bpm=round(tempo, 1),
            beat_times_ms=beat_times_ms,
            root=root,
            scale=scale,
            detected=True,
        )
        logger.info("节拍探测成功：%s", info)
        return info
    except Exception as e:  # noqa: BLE001
        logger.warning("节拍探测失败，回退目标 BPM=%.1f：%s", fallback_bpm, e)
        return BeatInfo(
            bpm=fallback_bpm, beat_times_ms=[], root="A", scale="minor", detected=False
        )


def build_grid_ms(
    beat_info: BeatInfo,
    total_ms: float,
    *,
    subdivision: int = 2,
    offset_ms: float = 0.0,
) -> list[float]:
    """
    构造对齐用的时间网格（毫秒）。
    - 若有探测拍点：在相邻拍之间插入 subdivision 等分点；
    - 否则按 bpm 均匀生成网格。
    """
    grid: list[float] = []
    beats = beat_info.beat_times_ms
    if beats and len(beats) >= 2:
        for i in range(len(beats) - 1):
            a, b = beats[i], beats[i + 1]
            for s in range(subdivision):
                grid.append(a + (b - a) * (s / subdivision))
        grid.append(beats[-1])
        # 向后延伸到 total_ms
        step = (beats[-1] - beats[0]) / max(1, (len(beats) - 1)) / subdivision
        t = grid[-1] + step
        while t < total_ms and step > 1:
            grid.append(t)
            t += step
    else:
        beat_ms = 60000.0 / max(1.0, beat_info.bpm)
        step = beat_ms / max(1, subdivision)
        t = offset_ms
        while t < total_ms:
            grid.append(round(t, 1))
            t += step
    return grid


def snap_ms(value_ms: float, grid_ms: list[float], *, max_shift_ms: float = 60.0) -> float:
    """把一个时间点吸附到最近网格线；偏移超过 max_shift_ms 时不吸附（避免撕裂节奏）。"""
    if not grid_ms:
        return value_ms
    # 网格已升序；线性/二分找最近
    lo, hi = 0, len(grid_ms) - 1
    if value_ms <= grid_ms[0]:
        nearest = grid_ms[0]
    elif value_ms >= grid_ms[-1]:
        nearest = grid_ms[-1]
    else:
        while lo <= hi:
            mid = (lo + hi) // 2
            if grid_ms[mid] < value_ms:
                lo = mid + 1
            else:
                hi = mid - 1
        cand = [grid_ms[max(0, hi)], grid_ms[min(len(grid_ms) - 1, lo)]]
        nearest = min(cand, key=lambda g: abs(g - value_ms))
    if abs(nearest - value_ms) > max_shift_ms:
        return value_ms
    return nearest
