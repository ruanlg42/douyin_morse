# 后端（摩斯前奏 · 与旧 generate_morse_music 对齐）

Python 3.8+，依赖见 `requirements.txt`。

## 运行 API

```bash
cd backend
pip install -r requirements.txt
export MINIMAX_API_KEY="你的密钥"   # 或使用 morse_api/key.json
python -m morse_api
```

默认监听 `http://0.0.0.0:8765`（可用环境变量 `PORT`、`HOST` 修改）。浏览器请访问 **http://127.0.0.1:8765/**（勿用 `0.0.0.0`）。

- `GET /` — 原版「声印」单页（`morse_api/static/index.html`）  
- `GET /api/health` — 健康检查  
- `GET /api/styles` — 音乐风格列表  
- `GET /api/demo` — 碟中谍示例（需 `morse_api/assets/mission.mp3`）  
- `POST /api/generate` — 生成音乐（body: `word`, `style`, `with_vocals`）  
- `/media/*` — 生成结果 MP3  
- `/assets/*` — 示例等静态文件  

## 命令行流水线（可选）

与 Web 共用同一套模块：

```bash
cd backend
python -m morse_api.run_demo --abbrev Lucas
```

算法与 MiniMax 细节见 `MUSIC_PIPELINE.md`。
