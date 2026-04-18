#!/usr/bin/env bash
# macOS：在终端一键启动（等价于 python3 start.py）
set -e
cd "$(dirname "$0")"
exec python3 start.py
