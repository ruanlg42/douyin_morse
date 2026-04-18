#!/usr/bin/env python3
"""
macOS 一键启动：先后端 FastAPI，再前端 Vite。

终端：在项目根目录执行
  python3 start.py
或：./start.sh

访达：双击「一键启动.command」（首次若提示权限，在「系统设置 → 隐私与安全性」中允许）。
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
HOST = os.environ.get("MORSE_API_HOST", "127.0.0.1")
PORT = os.environ.get("PORT", "8765")
HEALTH_URL = f"http://{HOST}:{PORT}/api/health"


def _vite_cli() -> Path:
    """Vite 6：可直接用 node 执行，避免 .bin/vite 未生成或 PATH 异常。"""
    return FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"


def _ensure_frontend_deps() -> bool:
    if _vite_cli().is_file():
        return True
    print("未检测到 frontend/node_modules（尚未 npm install），正在安装依赖，首次可能需 1～3 分钟…")
    r = subprocess.run(
        ["npm", "install"],
        cwd=str(FRONTEND),
        env=os.environ.copy(),
    )
    if r.returncode != 0:
        print("错误：npm install 失败，请手动执行：", file=sys.stderr)
        print(f"  cd {FRONTEND} && npm install", file=sys.stderr)
        return False
    if not _vite_cli().is_file():
        print("错误：安装后仍找不到 vite，请检查 frontend/package.json。", file=sys.stderr)
        return False
    print("前端依赖已就绪。\n")
    return True


def _backend_deps_ok() -> bool:
    """与启动后端时使用同一解释器，避免 pip 装到 conda、python3 却是系统 Python。"""
    r = subprocess.run(
        [sys.executable, "-c", "import uvicorn, fastapi"],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def main() -> int:
    if not BACKEND.is_dir() or not (BACKEND / "morse_api").is_dir():
        print("错误：未找到 backend/morse_api，请在项目根目录运行。", file=sys.stderr)
        return 1
    if not (FRONTEND / "package.json").is_file():
        print("错误：未找到 frontend/package.json。", file=sys.stderr)
        return 1

    if not _backend_deps_ok():
        exe = sys.executable
        print("错误：当前 Python 未安装后端依赖（例如 uvicorn）。", file=sys.stderr)
        print(f"  正在使用的解释器: {exe}", file=sys.stderr)
        print("  请执行：", file=sys.stderr)
        print(f"    cd {BACKEND} && {exe} -m pip install -r requirements.txt", file=sys.stderr)
        print("  若使用 conda：先 conda activate，再在该环境中执行上述命令，并用 python start.py 启动。", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env.setdefault("HOST", "0.0.0.0")

    print("启动后端:", BACKEND)
    proc = subprocess.Popen(
        [sys.executable, "-m", "morse_api"],
        cwd=str(BACKEND),
        env=env,
    )

    def shutdown(*_: object) -> None:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()

    signal.signal(signal.SIGINT, lambda s, f: (shutdown(), sys.exit(130)))
    signal.signal(signal.SIGTERM, lambda s, f: (shutdown(), sys.exit(143)))

    print(f"等待 API: {HEALTH_URL}")
    ok = False
    for _ in range(75):
        if proc.poll() is not None:
            print("后端进程已退出。安装依赖示例：", file=sys.stderr)
            print(f"  cd {BACKEND} && {sys.executable} -m pip install -r requirements.txt", file=sys.stderr)
            return 1
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=0.6) as resp:
                if resp.status == 200:
                    ok = True
                    break
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    if not ok:
        print("错误：后端未在预期时间内就绪。", file=sys.stderr)
        shutdown()
        return 1

    if shutil.which("npm") is None or shutil.which("node") is None:
        print("错误：未找到 node 或 npm，请先安装 Node.js（macOS：brew install node）。", file=sys.stderr)
        shutdown()
        return 1
    if not _ensure_frontend_deps():
        shutdown()
        return 1

    print("启动前端: Vite → http://127.0.0.1:5173")
    print("按 Ctrl+C 将结束前端并停止后端。\n")
    try:
        # 用 node 直接跑 vite.js，避免 sh: vite: command not found
        node = os.environ.get("NODE_BINARY") or shutil.which("node") or "node"
        subprocess.run(
            [node, str(_vite_cli())],
            cwd=str(FRONTEND),
            env=env,
            check=False,
        )
    finally:
        shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
