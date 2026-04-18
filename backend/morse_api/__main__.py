"""在 backend 目录下执行: python -m morse_api"""
from __future__ import annotations

import os

if __name__ == "__main__":
    import uvicorn

    from .main import app

    port = int(os.environ.get("PORT", "8765"))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
