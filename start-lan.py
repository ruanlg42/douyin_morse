#!/usr/bin/env python3
"""
局域网体验：后端 0.0.0.0:8765 + 前端 Vite 0.0.0.0:5173

同一 WiFi 下的手机/平板浏览器打开：
  http://<本机局域网IP>:5173

项目根目录执行：
  python3 start-lan.py
"""
from __future__ import annotations

import os
import shutil
import signal
import socket
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
VITE_PORT = os.environ.get("VITE_PORT", "5173")


def _vite_cli() -> Path:
    return FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"


def _lan_ips() -> list[str]:
    ips: list[str] = []
    if sys.platform == "darwin":
        for iface in ("en0", "en1", "bridge0"):
            try:
                out = subprocess.check_output(
                    ["ipconfig", "getifaddr", iface],
                    stderr=subprocess.DEVNULL,
                    text=True,
                ).strip()
                if out:
                    ips.append(out)
            except (subprocess.CalledProcessError, FileNotFoundError):
                pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return list(dict.fromkeys(ip for ip in ips if ip and not ip.startswith("127.")))


def _ensure_frontend_deps() -> bool:
    if _vite_cli().is_file():
        return True
    print("未检测到 frontend/node_modules，正在 npm install…")
    r = subprocess.run(["npm", "install"], cwd=str(FRONTEND), env=os.environ.copy())
    return r.returncode == 0 and _vite_cli().is_file()


def _backend_deps_ok() -> bool:
    r = subprocess.run(
        [sys.executable, "-c", "import uvicorn, fastapi"],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def main() -> int:
    if not _backend_deps_ok():
        print("请先安装后端依赖：", file=sys.stderr)
        print(f"  cd {BACKEND} && {sys.executable} -m pip install -r requirements.txt", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env.setdefault("HOST", "0.0.0.0")

    print("启动后端 (0.0.0.0:" + PORT + ")…")
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
            return 1
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=0.6) as resp:
                if resp.status == 200:
                    ok = True
                    break
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    if not ok:
        print("后端未就绪。", file=sys.stderr)
        shutdown()
        return 1

    if not _ensure_frontend_deps():
        shutdown()
        return 1

    ips = _lan_ips()
    print("\n════════════════════════════════════════")
    print("  本机：  http://127.0.0.1:" + VITE_PORT)
    for ip in ips:
        print(f"  局域网：http://{ip}:{VITE_PORT}")
    if not ips:
        print("  （未检测到局域网 IP，请在本机 WiFi 设置中查看）")
    print("  同一 WiFi 下的手机/平板用「局域网」地址打开")
    print("  按 Ctrl+C 结束")
    print("════════════════════════════════════════\n")

    node = os.environ.get("NODE_BINARY") or shutil.which("node") or "node"
    try:
        subprocess.run(
            [node, str(_vite_cli()), "--host", "0.0.0.0", "--port", VITE_PORT],
            cwd=str(FRONTEND),
            env=env,
            check=False,
        )
    finally:
        shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
