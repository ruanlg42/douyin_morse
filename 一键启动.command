#!/bin/bash
# macOS 访达双击：在本目录打开终端并启动前后端（需已安装依赖，见 README）
cd "$(dirname "$0")"
set -e
python3 start.py
echo ""
read -r -p "已退出。按回车键关闭窗口…"
