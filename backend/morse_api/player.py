"""跨平台简单播放（调试）：优先使用系统自带播放器，避免额外 Python 依赖。"""
from __future__ import annotations

import logging
import platform
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def play_audio(path: Path) -> None:
    """非阻塞/弱阻塞地打开本地音频；失败时仅记录日志。"""
    path = path.resolve()
    if not path.is_file():
        logger.error("播放跳过：文件不存在 %s", path)
        return

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["afplay", str(path)], check=True)
        elif system == "Windows":
            # 使用默认关联程序打开
            subprocess.run(
                ["cmd", "/c", "start", "", str(path)],
                check=False,
                shell=False,
            )
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception as e:
        logger.warning("播放失败（可忽略）：%s", e)
