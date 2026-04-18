# 部署到 ModelScope 创空间（MorseMelodyPlay）

本项目为 **FastAPI 后端 + React(Vite) 一体化前端**。在 [ModelScope Studio](https://www.modelscope.cn/studios/lg0402/MorseMelodyPlay) 上通过 **Docker** 暴露 **7860** 端口即可运行完整 App（与官方示例一致）。

官方流程说明见：[ModelScope 文档中心](https://modelscope.cn/docs)（创空间 / 镜像构建）。

---

## 空间内仓库应包含的文件

| 文件 | 作用 |
|------|------|
| `app.py` | 入口：启动 Uvicorn，挂载 `PORT`（默认 7860）、`MORSE_SPA_DIST` |
| `Dockerfile` | 多阶段构建：Node 打前端 `dist` + Python 镜像运行后端 |
| `backend/` | FastAPI 服务（`/api/*`、`/media`、`/assets`） |
| `frontend/` | 源码；镜像构建时执行 `npm ci && npm run build` |
| `data/` | 猜码题库 `static-quiz.json`；构建前端时与 `frontend/` 同级复制进镜像，勿删 |

**不要**把带密码的 clone URL 提交到公开仓库。请使用平台提供的「克隆」命令或个人访问令牌（勿写入文档或代码）。

---

## 上传到魔搭创空间（Git 推送）

1. 登录 [魔搭 ModelScope](https://www.modelscope.cn/) → 进入你的 **创空间**（如 [MorseMelodyPlay](https://www.modelscope.cn/studios/lg0402/MorseMelodyPlay)）→ **设置 / 代码** → 复制平台给出的 **Git 克隆地址**。
2. 在 [访问令牌](https://modelscope.cn/my/myaccesstoken) 创建 **Git 令牌**（用于 `git push`，勿泄露）。
3. 本地在项目根目录执行（首次）：

```bash
cd /path/to/final
git init
git lfs install
git remote add origin https://oauth2:<你的Git令牌>@www.modelscope.cn/studios/<用户名>/<创空间仓库名>.git
```

4. 提交并推送（按平台默认分支名替换 `master` 或 `main`）：

```bash
git add app.py Dockerfile .dockerignore backend frontend data MODELSCOPE.md
git commit -m "chore: sync studio"
git push -u origin master
```

若创空间已有远程历史，先 `git pull origin master --allow-unrelated-histories` 再推送，或按平台说明强制同步。

5. 回到创空间页面 **重新构建** 镜像；环境变量里按需配置 `MINIMAX_API_KEY`。

---

## 本地验证镜像逻辑（可选）

```bash
docker build -t morse-melody:test .
docker run --rm -p 7860:7860 -e MINIMAX_API_KEY=你的密钥 morse-melody:test
```

浏览器访问：`http://127.0.0.1:7860`

---

## 环境变量（ModelScope 控制台配置）

| 变量 | 说明 |
|------|------|
| `MINIMAX_API_KEY` | **生成音乐**接口需要；仅使用「碟中谍示例」可不配 |
| `PORT` | 默认 `7860`，一般无需改 |
| `HOST` | 默认 `0.0.0.0` |

密钥文件模式：若使用 `backend/morse_api/key.json`，需自行挂载或打包策略（生产更推荐只用环境变量）。

---

## Git 提交与推送（与官方 Step 4 一致）

```bash
git lfs install
git add app.py Dockerfile .dockerignore backend frontend data MODELSCOPE.md
git commit -m "Add ModelScope Docker deployment"
git push
```

若创空间要求根目录仅有 `app.py` + `Dockerfile`，保持本仓库结构即可：Docker **构建上下文**仍为整个项目目录（含 `backend/`、`frontend/`）。

---

## 技术说明（便于排错）

- 前端静态资源构建在镜像内的 `frontend/dist`，通过环境变量 `MORSE_SPA_DIST` 交给 FastAPI，在**所有 API 路由之后**挂载，避免挡住 `/api`、`/media`、后端 `/assets`（示例 `mission.mp3`）。
- Vite 构建的 JS/CSS 放在 **`/bundle/`** 下，与后端静态目录 **`/assets/`** 路径区分，避免冲突。
- 镜像内已安装 **ffmpeg**，供 `pydub` 混音使用。

更多使用说明请参阅 [ModelScope 文档中心](https://modelscope.cn/docs)。
