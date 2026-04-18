#!/usr/bin/env python3
"""
ModelScope Studio / Docker 入口：单进程 Uvicorn，同时提供 FastAPI 与一体化前端静态资源。

本地调试（需先构建前端）：
  cd frontend && npm run build && cd ..
  export MORSE_SPA_DIST="$(pwd)/frontend/dist"
  export PORT=7860
  python app.py

环境变量：
  PORT           默认 7860（与 ModelScope 示例一致）
  HOST           默认 0.0.0.0
  MORSE_SPA_DIST 前端 dist 绝对路径；Dockerfile 已设为 /home/user/app/frontend/dist
  MINIMAX_API_KEY  生成音乐时需要（可在 ModelScope 控制台配置）
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
DIST = ROOT / "frontend" / "dist"

sys.path.insert(0, str(BACKEND))

os.environ.setdefault("HOST", "0.0.0.0")
os.environ.setdefault("PORT", "7860")
if DIST.is_dir() and (DIST / "index.html").is_file():
    os.environ.setdefault("MORSE_SPA_DIST", str(DIST))

if __name__ == "__main__":
    import uvicorn

    from morse_api.main import app as fastapi_app

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run(fastapi_app, host=host, port=port, log_level="info")
