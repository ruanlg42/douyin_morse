# Morse · Learn（macOS）

摩斯码学习（视频 + 测验）+ **声印**（词 → 摩斯前奏 + AI 音乐）+ 发报沙盒。  
前端：**Vite + React + Tailwind**（`frontend/`）。后端：**FastAPI**（`backend/morse_api/`）。

**产品功能总览见 [PRODUCT.md](./PRODUCT.md)**；实现与脚本细节见 [PROGRAM.md](./PROGRAM.md)。

---

## 一键启动（macOS）

**方式 A — 终端（推荐）**

```bash
cd /你的路径/final
python3 start.py
```

或：`chmod +x start.sh && ./start.sh`

**方式 B — 访达双击**

双击项目根目录里的 **`一键启动.command`**（会用「终端」打开并执行；若提示无法打开，到 **系统设置 → 隐私与安全性** 允许）。

浏览器访问：**http://127.0.0.1:5173**。在前端终端按 **Ctrl+C** 可同时结束前端并停止后端。

**说明**：若尚未在 `frontend` 执行过 `npm install`，`start.py` 会在启动 Vite **前自动运行** `npm install`（需本机已安装 **Node**，首次可能 1～3 分钟）。

**只起后端**（`cd backend && python3 -m morse_api`）时，可打开 **http://127.0.0.1:8765/** 使用原版 **「声印」单页**（`morse_api/static/index.html`，与旧 `generate_morse_music` 行为一致）；完整三 Tab 仍需 `start.py` 或 `npm run dev`。

---

## 首次安装依赖

1. **Homebrew**（可选）：`brew install python node ffmpeg`（ffmpeg 建议装，用于鼓点/混音/视频脚本）

2. **Python**（与 `python3 start.py` 为同一解释器）：

   ```bash
   cd /你的路径/final
   cd backend && python3 -m pip install -r requirements.txt
   ```

   **Node**：需已安装（`brew install node`）。前端依赖可由 **`start.py` 自动 `npm install`**；也可手动：`cd frontend && npm install`。

   使用 **conda** 时：先 `conda activate`，`python3` 改为 `python`，并用 **`python start.py`** 启动。

---

## 目录结构

```
├── 一键启动.command    # 访达双击启动
├── start.py            # 一键启动逻辑
├── start.sh            # 终端：./start.sh
├── frontend/
├── backend/
├── scripts/
├── PROGRAM.md
└── README.md
```

## 手动分终端开发（可选）

```bash
# 终端 1
cd backend && export MINIMAX_API_KEY="你的密钥" && python3 -m morse_api

# 终端 2
cd frontend && npm run dev
```

## 学习页视频

将 `A.mp4` … `Z.mp4` 放在 **`frontend/public/letter/`**。可用 `scripts/enhance_videos.py` 批量处理（见脚本内说明）。

## 声印示例音频

需要 **`backend/morse_api/assets/mission.mp3`**（见该目录 `README.md`）。

## 技术关系

| 层级 | 职责 |
|------|------|
| `frontend` | 三 Tab UI；开发时 Vite 代理 `/api`、`/media`、`/assets` 到后端 |
| `backend` | 摩斯 → 鼓点 → MiniMax → 混音；提供 JSON 与媒体文件 |

无代理预览前端时，可在 `frontend/.env` 设置：`VITE_API_BASE=http://127.0.0.1:8765`。
