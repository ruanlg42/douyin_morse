#!/usr/bin/env python3
"""
端到端入口：缩写 → 摩斯 → 鼓点 MP3 → MiniMax music-2.6-free → 混音合成 → 成品 MP3 → 可选播放。

在仓库 backend 目录下：
    pip install -r requirements.txt
    export MINIMAX_API_KEY="你的密钥"   # 可选；否则使用 morse_api/key.json
    python -m morse_api.run_demo --abbrev Lucas

调试（不调用 API，仅生成鼓点）：
    python -m morse_api.run_demo --abbrev Lucas --skip-api
"""
from __future__ import annotations

import argparse
import base64
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from .config import DemoConfig, load_config
from .drum_synth import render_drum_reference
from .key_loader import load_bearer_token
from .minimax_client import (
    MiniMaxAPIError,
    build_cover_prompt,
    build_lyrics_from_morse,
    build_vocal_prompt,
    music_cover_from_base64,
)
from .morse_codec import abbrev_to_morse
from .player import play_audio


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def _resolve_api_key(cfg: DemoConfig, key_file: Optional[Path]) -> str:
    env_k = os.environ.get("MINIMAX_API_KEY", "").strip()
    if env_k:
        logging.getLogger(__name__).info("使用环境变量 MINIMAX_API_KEY。")
        return env_k
    kf = key_file or cfg.key_file
    return load_bearer_token(Path(kf).resolve())


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="摩斯鼓点 + MiniMax 混音合成 端到端 Demo")
    parser.add_argument(
        "--abbrev",
        default=None,
        help="英文缩写，1–10 个字母（默认读取配置 default_abbrev）",
    )
    parser.add_argument("--key-file", default=None, help="API Key 文件路径，默认 morse_api/key.json")
    parser.add_argument(
        "--out-dir",
        default=None,
        help="输出目录（默认 morse_api/outputs）",
    )
    parser.add_argument("--skip-api", action="store_true", help="仅生成摩斯与鼓点，不调用 MiniMax")
    parser.add_argument("--with-vocal", action="store_true", help="生成带人声和歌词的版本（默认纯音乐）")
    parser.add_argument("--no-play", action="store_true", help="生成完成后不自动播放")
    parser.add_argument("--bpm", type=int, default=None, help="覆盖默认 BPM（默认 120；越大鼓点越快）")
    parser.add_argument(
        "--dash-ratio",
        type=float,
        default=None,
        help="长音/短音时长倍数（默认 4.0；2.0 更快，8.0 为旧版二分音符）",
    )
    parser.add_argument("--verbose", action="store_true", help="调试日志")
    args = parser.parse_args(argv)

    _setup_logging(args.verbose)
    log = logging.getLogger("run_demo")

    cfg = load_config()
    from dataclasses import replace

    overrides: dict = {}
    if args.bpm is not None:
        overrides["bpm"] = int(args.bpm)
    if args.dash_ratio is not None:
        overrides["dash_ratio"] = float(args.dash_ratio)
    if overrides:
        cfg = replace(cfg, **overrides)
        log.info("应用 CLI 覆盖：%s", overrides)
    abbrev = (args.abbrev or cfg.default_abbrev).strip()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else Path(cfg.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    safe = "".join(c for c in abbrev.lower() if c.isalnum()) or "user"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    drum_mp3 = out_dir / f"{safe}_{stamp}_morse_drum.mp3"
    drum_wav = out_dir / f"{safe}_{stamp}_morse_drum.wav"
    music_mp3 = out_dir / f"{safe}_{stamp}_morse_music.mp3"

    # --- 1) 摩斯 ---
    log.info("【1/5】摩斯电码生成…")
    morse = abbrev_to_morse(abbrev)
    print(f"输入缩写（规范化）: {morse.abbrev_normalized}")
    print(f"摩斯（点划）: {morse.morse_dot_dash}")
    print(f"摩斯（可视化）: {morse.morse_pretty}")
    print("摩斯电码生成完成。")

    # --- 2) 鼓点 ---
    log.info("【2/5】鼓点合成（16 分=短音，二分=长音，字母间休止）…")
    drum_path = render_drum_reference(
        morse.morse_dot_dash,
        cfg,
        drum_mp3,
        wav_fallback=drum_wav,
    )
    print(f"鼓点音频保存成功：{drum_path.resolve()}")

    if args.skip_api:
        print("已跳过 MiniMax API（--skip-api）。")
        if cfg.auto_play and not args.no_play:
            play_audio(drum_path)
        return 0

    # --- 3) MiniMax ---
    log.info("【3/5】调用 MiniMax music-2.6-free 生成音乐…")
    print("API 调用中：生成 AI 音乐 …")
    try:
        api_key = _resolve_api_key(cfg, Path(args.key_file) if args.key_file else None)
    except Exception as e:
        log.exception("读取 API Key 失败")
        print(f"错误：API Key 配置无效 —— {e}")
        return 2

    ref_path = Path(drum_path)
    if not ref_path.is_file():
        print(f"错误：参考音频不存在 {ref_path}")
        return 2
    ref_bytes = ref_path.read_bytes()
    b64 = base64.b64encode(ref_bytes).decode("ascii")
    
    # 根据 --with-vocal 参数决定生成纯音乐还是带人声的版本
    if args.with_vocal:
        prompt = build_vocal_prompt()
        lyrics = build_lyrics_from_morse(morse.abbrev_normalized, morse.morse_dot_dash)
        print(f"生成带人声版本，歌词预览：\n{lyrics[:100]}...")
        music_type = "带人声"
    else:
        prompt = build_cover_prompt()
        lyrics = None
        music_type = "纯音乐"

    try:
        audio_bin = music_cover_from_base64(cfg, api_key, b64, prompt, lyrics)
    except MiniMaxAPIError as e:
        log.error("MiniMax 调用失败：%s", e)
        print(f"错误：{e}")
        if isinstance(e.raw, dict):
            print("原始 JSON 片段已写入日志（--verbose 查看完整）。")
        return 3
    except Exception as e:
        log.exception("未预期错误")
        print(f"错误：{e}")
        return 4

    music_mp3.write_bytes(audio_bin)
    print(f"AI 音乐生成完成：{music_mp3.resolve()}")

    # --- 4) 混音合成 ---
    log.info("【4/5】混音合成（鼓点 + AI音乐）…")
    print("混音合成中 …")
    try:
        from pydub import AudioSegment
        drum_audio = AudioSegment.from_mp3(drum_path)
        music_audio = AudioSegment.from_mp3(music_mp3)
        max_len = max(len(drum_audio), len(music_audio))
        if len(drum_audio) < max_len:
            drum_audio = drum_audio + AudioSegment.silent(duration=max_len - len(drum_audio))
        if len(music_audio) < max_len:
            music_audio = music_audio + AudioSegment.silent(duration=max_len - len(music_audio))
        # 混音：鼓点音量降低 12dB 作为节奏层
        mixed = music_audio.overlay(drum_audio - 12)
        mixed_mp3 = out_dir / f"{safe}_{stamp}_morse_mixed.mp3"
        mixed.export(str(mixed_mp3), format="mp3", bitrate="256k")
        print(f"混音完成：{mixed_mp3.resolve()}")
    except Exception as e:
        log.warning("混音失败（可忽略）：%s", e)
        mixed_mp3 = music_mp3

    # --- 5) 播放 ---
    if cfg.auto_play and not args.no_play:
        log.info("【5/5】播放调试 …")
        print("播放合成音乐（鼓点节奏 + AI生成）…")
        play_audio(mixed_mp3)
    else:
        print("已关闭自动播放（--no-play 或 config.auto_play=False）。")

    print("全流程结束。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
