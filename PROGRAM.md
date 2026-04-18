# Morse · Learn — 程序说明（全览）

本文档描述仓库**整体程序**：产品功能、技术架构、目录职责、接口约定、配置与运行方式。偏「说明书」；算法与 MiniMax 细节另见 `backend/MUSIC_PIPELINE.md`。

---

## 1. 程序是做什么的

面向 **A–Z 摩斯码** 的轻量学习工具，并扩展一条 **「声印」** 创意链路：用户输入短英文词 → 服务端把词编成摩斯 → 生成鼓点前奏 → 调用 **MiniMax** 生成音乐 → 与前奏混音 → 浏览器播放并同步高亮字母与点划动画。

| 模块 | 用户侧能力 |
|------|------------|
| **学习** | 按字母观看教学视频（`public/letter/*.mp4`）、对照摩斯；长按/短按输入点划做练习。 |
| **测试** | 随机或顺序出题，输入摩斯判对错；含速度分、连击、累计分等。 |
| **声印（music）** | 输入 1–10 个字母、选风格、可选人声，请求后端生成 MP3；可加载「碟中谍」示例（需自备 `mission.mp3`）。 |
| **发报沙盒（play）** | 自由发报，以图形记录点/划序列（不做自动译码）。 |

---

## 2. 技术栈一览

| 层级 | 技术 |
|------|------|
| 前端 | **React 18**、**Vite 6**、**Tailwind CSS 3**、**lucide-react** |
| 后端 | **Python 3.8+**、**FastAPI**、**Uvicorn**、**NumPy**、**pydub**、**requests** |
| 外部服务 | **MiniMax**（文本提示 + 音乐生成 API）；本机需 **ffmpeg**（鼓点 MP3、混音、视频脚本） |

---

## 3. 仓库目录结构

```
final/                          # 项目根目录
├── PROGRAM.md                  # 本文件：整程序说明
├── README.md                   # 快速入口：启动与目录索引
├── start.py                    # macOS 一键启动（后端 + 前端）
├── start.sh                    # 终端：./start.sh
├── 一键启动.command             # 访达双击启动（macOS）
├── .gitignore
│
├── frontend/                   # 前端工程
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js          # 开发代理：/api、/media、/assets → 后端
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.example            # 可选 VITE_API_BASE
│   ├── public/letter/          # A.mp4 … Z.mp4（自备）
│   └── src/
│       ├── main.jsx            # React 挂载点
│       ├── index.css           # Tailwind + 全局移动端样式
│       ├── api.js              # API 基址：开发走代理，生产可设 VITE_API_BASE
│       └── App.jsx             # 三 Tab 单文件 UI 与交互逻辑
│
├── backend/                    # 后端工程（承接原 generate_morse_music 职责）
│   ├── README.md               # 后端简短说明
│   ├── requirements.txt
│   ├── MUSIC_PIPELINE.md       # 摩斯→鼓点→MiniMax 管线详解
│   └── morse_api/              # Python 包
│       ├── __main__.py         # python -m morse_api
│       ├── main.py             # FastAPI：GET / 声印单页 + /api/* + 媒体目录
│       ├── static/index.html   # 原版「声印」静态试玩（与旧包 static 一致）
│       ├── config.py           # DemoConfig、PACKAGE_DIR、load_config
│       ├── morse_codec.py      # 缩写校验与摩斯编码
│       ├── drum_synth.py       # 摩斯时间线 + 鼓音色合成
│       ├── styles.py           # 音乐风格档位（UI 与鼓音色、提示词）
│       ├── minimax_client.py   # 文本模型 + music_generation 调用
│       ├── key_loader.py       # key.json / Bearer 解析
│       ├── player.py           # CLI 调试播放（系统播放器）
│       ├── run_demo.py         # 不经过 Web 的端到端 CLI
│       ├── key.json            # API Key（本地，勿提交敏感环境）
│       ├── assets/             # 示例 mission.mp3 等
│       └── outputs/            # 生成的 MP3（运行期写入）
│
└── scripts/
    └── enhance_videos.py       # 可选：ffmpeg 批量增强 letter 视频
```

---

## 4. 前后端如何协作

### 4.1 开发时（推荐）

1. 后端监听 **`0.0.0.0:8765`**（或 `PORT` 覆盖）。
2. 前端 Vite 监听 **`127.0.0.1:5173`**，并把以 `/api`、`/media`、`/assets` 开头的请求**代理**到后端。
3. 浏览器只访问 **http://127.0.0.1:5173**；前端 `api.js` 中 **`VITE_API_BASE` 为空** 时使用相对路径，请求经 Vite 转发。

### 4.2 预览 / 无代理场景

前端构建后若与 API 不同源，在 `frontend/.env` 设置：

```bash
VITE_API_BASE=http://127.0.0.1:8765
```

---

## 5. 后端 HTTP API

基址示例：`http://127.0.0.1:8765`（开发中通常不直接写死，由前端代理或 `VITE_API_BASE` 拼接）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 原版「声印」单页 HTML（`static/index.html`） |
| GET | `/api/health` | 健康检查，返回 `{"ok": true, "service": "morse-music-api"}` |
| GET | `/api/styles` | 返回 `{"styles": [{"id", "label"}, ...]}` |
| GET | `/api/demo` | 碟中谍示例 JSON（含 `audio_url`、`letter_timeline`、`intro_duration_ms` 等）；无 `assets/mission.mp3` 时 404 |
| POST | `/api/generate` | Body JSON：`word`（必填）、`style`（可选）、`with_vocals`（布尔）。成功返回 `audio_url`（多为 `/media/...`）、时间轴与特效字段等 |
| 静态 | `/media/*` | 生成结果 MP3 |
| 静态 | `/assets/*` | 示例等静态文件 |

生成接口依赖有效 **MiniMax** 密钥与网络；校验失败返回 400，上游错误多为 502。

---

## 6. 声印生成数据流（概要）

1. `word` → `morse_codec.abbrev_to_morse` → 点划串（字母间空格）。
2. `drum_synth.render_intro_drums_with_timeline` 按当前 **风格** 选短/长音色，生成前奏 WAV 与 **letter_timeline**。
3. `minimax_client`：可选文本模型生成器乐/人声提示词与歌词 → `music_cover_from_base64` 生成整曲 MP3。
4. `main._mix_intro_drums_with_music`：前奏段鼓与音乐叠化混音，写入 `outputs/`，返回 `/media/文件名.mp3`。

更细的节拍比例、错误码、CLI 参数见 **`backend/MUSIC_PIPELINE.md`**。

---

## 7. 前端三个 Tab 与关键文件

- **`App.jsx`**：顶层 `activeTab` 切换 `learn` / `music` / `play`。
- **学习**：`<video src="/letter/X.mp4">`（静态资源来自 `public/letter`）；点划阈值约 **250 ms** 区分点与划；视频结束自动循环与切字母逻辑在同文件内。
- **声印**：`fetch(apiUrl('/api/styles'|'/api/demo'|'/api/generate'))`；`<audio>` 与时间轴同步高亮；摩斯字符 CSS 动画类名如 `bloom`、`hit` 等。
- **沙盒**：仅累积 `dot`/`dash` 图形列表，无解码表。

---

## 8. 配置与环境变量

| 变量 | 作用 |
|------|------|
| `MINIMAX_API_KEY` | MiniMax 密钥（推荐）；否则读 `backend/morse_api/key.json` |
| `MINIMAX_API_BASE` | API 根 URL，见 `config.load_config()` |
| `MORSE_BPM` / `MORSE_DASH_RATIO` | 覆盖默认 BPM、长短音比例 |
| `PORT` / `HOST` | 后端监听（`python -m morse_api` 与 `start.py` 继承环境） |
| `VITE_API_BASE` | 前端直连 API 基址（无 Vite 代理时使用） |
| `LETTER_INPUT_DIR` / `LETTER_OUTPUT_DIR` | `scripts/enhance_videos.py` 输入输出目录 |
| `MORSE_API_HOST` | `start.py` 轮询健康检查用的主机（默认 `127.0.0.1`） |

---

## 9. 启动方式汇总

| 方式 | 命令或操作 |
|------|------------|
| 一键 | macOS：`python3 start.py`、`./start.sh`，或访达双击 `一键启动.command` |
| 手动双终端 | `cd backend && python -m morse_api`；`cd frontend && npm run dev` |
| 仅 CLI 流水线 | `cd backend && python -m morse_api.run_demo --abbrev Lucas`（见 `--skip-api` 等） |

首次需：`backend` 下 `pip install -r requirements.txt`，`frontend` 下 `npm install`。

---

## 10. 构建前端（可选）

```bash
cd frontend
npm run build
npm run preview
```

若 `preview` 无代理，请配置 **`VITE_API_BASE`** 指向已启动的后端。

---

## 11. 依赖与常见问题

- **ffmpeg**：鼓点导出 MP3、混音、`enhance_videos.py` 均建议系统 PATH 中存在 `ffmpeg`。
- **学习页无视频**：检查 `frontend/public/letter/{A-Z}.mp4` 是否存在。
- **示例无法播放**：将合规音源存为 **`backend/morse_api/assets/mission.mp3`**。
- **声印生成失败**：检查 Key、额度、限流及 `MUSIC_PIPELINE.md` 中的错误码说明。
- **Vite 报网卡/权限**：可用 `vite --host 127.0.0.1`；一键启动里前端由 `npm run dev` 读取 `vite.config.js`。

---

## 12. 相关文档索引

| 文档 | 内容 |
|------|------|
| `README.md` | 最短上手：目录、一键启动、视频与示例说明 |
| `PROGRAM.md` | **本文件**：整程序功能与架构总览 |
| `backend/README.md` | 后端运行与路由列表 |
| `backend/MUSIC_PIPELINE.md` | 摩斯节奏映射、MiniMax 请求与 CLI |
| `backend/morse_api/assets/README.md` | `mission.mp3` 放置说明 |

---

以上为当前仓库「整个程序」的 Markdown 总览；若你后续增加路由或拆分前端组件，可同步改 **§3、§5、§7** 三节即可保持文档一致。
