"""
集中管理可配置参数，避免魔法数字分散在业务代码中。

修改方式：
- 直接改本文件默认值；或
- 在运行前设置环境变量（若某参数需要可从 os.environ 读取时再扩展）。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PACKAGE_DIR: Path = Path(__file__).resolve().parent


@dataclass(frozen=True)
class DemoConfig:
    """Demo 运行参数。"""

    # --- 音频与时间 ---
    sample_rate: int = 44100
    bpm: int = 120
    # 长音(「-」)相对短音(「.」)的时长倍数。
    # 说明：原实现用「16 分 vs 二分」(=8 倍) 会让横线拖得很长；
    # 这里默认 4 倍 = 「16 分 vs 四分」，节奏更紧凑，且保留清晰的长短对比。
    # 若想进一步贴近电信摩斯 1:3 规范，可改为 3.0；想更「音乐化」可保留 4.0。
    dash_ratio: float = 4.0
    # 鼓点参考音频目标时长（秒）：需落在 MiniMax 参考音频 6s–6min 内，并满足题目 10–20s 建议
    drum_target_min_sec: float = 10.0
    drum_target_max_sec: float = 20.0
    # 随机鼓音色（短噪声种子），固定后便于复现
    drum_seed: int = 42

    # --- MiniMax ---
    # 官方文档：https://platform.minimaxi.com/docs/api-reference/music-generation
    # API 服务器地址：https://api.minimaxi.com
    api_base: str = "https://api.minimaxi.com"
    music_endpoint: str = "/v1/music_generation"
    # 使用 music-3.0 文生曲（路线 A：AI 编曲 f + 本地叠回摩斯 x，保证摩斯清晰可听）。
    # 说明：曾用 music-cover 想以摩斯音频做参考，但 cover 需参考音频含可识别人声(ASR+DTW)，
    #       纯器乐摩斯会报 2013 no lyrics detected，故改走 music-3.0 文生曲。
    music_model: str = "music-3.0"
    output_format: str = "hex"
    output_sample_rate: int = 44100
    output_bitrate: int = 256_000
    output_audio_format: str = "mp3"
    request_timeout_sec: int = 300
    # 音乐请求重试次数：首连易遇 TLS/Connection reset 抖动，指数退避重试后即成功
    music_retries: int = 6
    # 文本对话（M2-her）：用于根据用户名字生成「音乐生成」专用提示词
    text_chat_endpoint: str = "/v1/text/chatcompletion_v2"
    text_model: str = "M2-her"
    text_timeout_sec: int = 120
    text_max_completion_tokens: int = 1024

    # --- 路径 ---
    # 默认都指向包内相对路径，保证无论从哪里运行命令都能写入包自己的目录
    default_abbrev: str = "Lucas"
    key_file: Path = PACKAGE_DIR / "key.json"
    output_dir: Path = PACKAGE_DIR / "outputs"

    # --- 行为开关 ---
    auto_play: bool = True


def load_config() -> DemoConfig:
    """从环境变量覆盖部分字段（BPM、dash_ratio、API base）。"""
    import os

    base = os.environ.get("MINIMAX_API_BASE", "https://api.minimaxi.com").rstrip("/")
    kwargs: dict = {"api_base": base}
    bpm_env = os.environ.get("MORSE_BPM")
    if bpm_env:
        try:
            kwargs["bpm"] = int(float(bpm_env))
        except ValueError:
            pass
    dash_env = os.environ.get("MORSE_DASH_RATIO")
    if dash_env:
        try:
            kwargs["dash_ratio"] = float(dash_env)
        except ValueError:
            pass
    return DemoConfig(**kwargs)
