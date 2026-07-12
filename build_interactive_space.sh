#!/usr/bin/env bash
# 打包抖音互动空间离线包：完整前端（声印精选电台 + 星途信使游戏），零网络依赖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
SONGS_SRC="$ROOT/interactive_space/morse_jukebox/songs"
OUT_DIR="$ROOT/interactive_space/morse_app"
ZIP="$ROOT/interactive_space/morse_app.zip"
VALIDATOR="$ROOT/.trae/skills/interact-creation/scripts/h5-validator"

echo "==> 离线构建前端"
cd "$FRONTEND"
rm -rf dist
OFFLINE=1 node ./node_modules/vite/bin/vite.js build

echo "==> 精简资源并注入预生成曲目"
cd dist
rm -rf demo letter data img/mission-impossible-poster.png
mkdir -p songs
for s in love home star dream; do
  cp "$SONGS_SRC/$s.mp3" "songs/$s.mp3"
done

echo "==> 校验：不得有 fetch("
if grep -q 'fetch(' bundle/*.js; then
  echo "!! 检测到 fetch(，构建失败" >&2
  exit 1
fi

echo "==> 组装产物目录 $OUT_DIR"
rm -rf "$OUT_DIR" "$ZIP"
mkdir -p "$OUT_DIR"
cp -R . "$OUT_DIR/"

echo "==> 压缩为 zip（根目录直含 index.html，剔除 macOS 元数据）"
cd "$OUT_DIR"
zip -r -X "$ZIP" . -x '.*' -x '__MACOSX/*' >/dev/null

echo "==> h5-validator 扫描 zip"
node "$VALIDATOR" --max-size 8388608 "$ZIP"

echo "==> 完成：$ZIP"
du -sh "$ZIP"
