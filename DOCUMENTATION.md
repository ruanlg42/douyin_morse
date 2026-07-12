# 点划之间 · 产品与技术文档

> 一款把「摩斯电码 + AI 音乐生成 + 跳跃闯关游戏」深度串联的互动情感应用。
> 你敲下的每一段摩斯，会被编码成一段旋律动机，藏进一首专属 AI 音乐里；这首歌又能成为你在《星途信使》里振翅夜飞的关卡与 BGM。
>
> 技术栈：**Vite + React + TailwindCSS**（前端） / **FastAPI + NumPy + pydub + librosa**（后端） / **MiniMax**（文本 & 音乐大模型）。

---

## 目录

1. [产品概述](#1-产品概述)
2. [整体架构](#2-整体架构)
3. [功能模块详解](#3-功能模块详解)
   - 3.1 [声印 · AI 音乐生成](#31-声印--ai-音乐生成)
   - 3.2 [信使 · 星途信使跳跃游戏](#32-信使--星途信使跳跃游戏)
   - 3.3 [关卡码 · 社交玩法](#33-关卡码--社交玩法)
   - 3.4 [字母教学浮层](#34-字母教学浮层)
   - 3.5 [剧情猜码（PlayScreen，保留可回滚）](#35-剧情猜码)
4. [音乐合成链路（核心技术）](#4-音乐合成链路核心技术)
5. [后端 API 参考](#5-后端-api-参考)
6. [关键技术实现](#6-关键技术实现)
7. [目录结构与文件职责](#7-目录结构与文件职责)
8. [部署与运行](#8-部署与运行)
9. [降级与容错设计](#9-降级与容错设计)

---

## 1. 产品概述

### 1.1 核心理念
把「说不出口的话」编码成摩斯 → 变成一段能哼出来的旋律动机 → 融入一首专属 AI 音乐 → 再化作一场跳跃飞行。既是浪漫的情感「树洞」，也是可玩、可分享、可解谜的沉浸式游乐场。

### 1.2 三层体验心流

| 阶段 | 模块 | 用户动作 | 情感目标 |
|------|------|----------|----------|
| **编码** | 声印 / 字母教学 | 输入一个词，敲击摩斯电键 | 仪式感的物理级输入 |
| **创生** | 声印 AI 音乐 | 生成藏着摩斯动机的专属歌曲 | "秘密被温柔接纳"的惊喜 |
| **释放** | 信使跳跃游戏 | 照着云跳、拼词触发秘技、闯关登顶 | 情感宣泄与成就 |

### 1.3 两个主 Tab + 一个浮层

- **声印（music）**：词 → 摩斯 → AI 音乐生成与播放。
- **信使（play）**：`JumpGame` 跳跃闯关小游戏（弹弓瞄准 + 摩斯拼词 + 关卡码社交）。
- **字母教学浮层（learn overlay）**：26 字母的摩斯教学与练习，从信使的「⋯」菜单进入。

---

## 2. 整体架构

```
┌───────────────────────────── 前端（Vite + React + Tailwind） ─────────────────────────────┐
│  App.jsx（Tab 路由 + 全局音效）                                                            │
│   ├── MusicScreen   声印：输入词 / 选风格 / 试听 / 生成 / 播放                              │
│   ├── JumpGame.jsx  信使：Canvas 2D 游戏循环 + 弹弓物理 + 关卡码 + 主题特效                 │
│   ├── LearnScreen   字母教学浮层（learn/test 双模）                                         │
│   ├── morseAudio.js Web Audio CW 电键音（660Hz + 泛音 + LFO + 低通）                        │
│   └── jumpCode.js   关卡码可逆编解码（Crockford base32 + 旋转盐 + 校验位）                  │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            │  开发期 Vite 代理 /api /media /assets → :8765
                                            ▼
┌───────────────────────────── 后端（FastAPI :8765） ──────────────────────────────────────┐
│  main.py     API 路由 + 异步任务表 + 全曲 hook 混音（NumPy 采样域）                         │
│   ├── morse_codec.py   词 → 摩斯点划（A–Z）                                                 │
│   ├── drum_synth.py    摩斯 → 鼓点前奏 + 音高化「记忆动机 hook」                            │
│   ├── styles.py        12 种风格：乐器 / 提示词 / BPM / 调式 / 音色                          │
│   ├── minimax_client.py  文本 LLM（写编曲提示词/歌词） + 音乐模型（music-2.6-free）         │
│   ├── beat_align.py    librosa 探测 BPM/拍点/主调 + 网格吸附（可优雅降级）                   │
│   ├── config.py        BPM / 采样率 / 模型名 / 超时 等集中配置                              │
│   └── key_loader.py    从 key.json / 环境变量解析 MiniMax Bearer Token                      │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                              MiniMax 开放平台（api.minimaxi.com）
                              · M2-her（文本对话）    · music-2.6-free（音乐生成）
```

### 数据流总览
```
用户词 (LOVE)
  → morse_codec: ".-.. --- ...- ."
  → drum_synth.build_morse_hook: 调式内的音高动机（点=八分级进 / 划=长音落和弦音）
  → minimax_client: 文本 LLM 写编曲提示词（含 BPM/调式锚点）→ music-2.6-free 生成纯器乐
  → beat_align (librosa): 探测成品真实 BPM / 拍点 / 主调
  → main._mix_hook_across_track: hook 循环铺满全曲、吸附拍网格、分段音量 + 副歌 sidechain
  → 60s 裁剪 + 1.2s 淡出 → 256k MP3 → /media/xxx.mp3
```

---

## 3. 功能模块详解

### 3.1 声印 · AI 音乐生成

**入口**：`App.jsx` 的 `MusicScreen`。

**用户流程**
1. 输入 1–10 个英文字母（或点快捷灵感词 love/star/home…）。
2. 选择风格（12 种，见 [styles.py](backend/morse_api/styles.py)）与是否「加入人声」。
3. **试听摩斯动机**（免生成）：Web Audio 在浏览器零延迟合成音高化 hook，可先听旋律。
4. **生成我的歌**：走异步任务，进度条实时显示阶段（编码 → 合成动机 → 构思编曲 → AI 生成 → 节拍对齐混音 → 导出）。
5. 生成完成后播放，支持收藏、下载、逐字母摩斯可视化。

**关键特性**
- **摩斯真正融入音乐**：不是简单贴前奏，而是把摩斯变成有音高、贯穿全曲的「记忆动机 hook」（详见 [第 4 节](#4-音乐合成链路核心技术)）。
- **示例内置**：碟中谍主题（`/api/demo`，M+I 循环）、快乐小马 HORSE（`/api/demo-horse`）。
- **逐字母时间轴**：后端返回 `letter_timeline`（每字母起止毫秒 + 视觉特效类型），前端据此做点亮动画。

---

### 3.2 信使 · 星途信使跳跃游戏

**入口**：`App.jsx` 挂载 `JumpGame.jsx`（Canvas 2D + requestAnimationFrame 游戏循环）。

**核心玩法**
- **弹弓式瞄准**：反向拉动蓄力，抛物线跳跃（物理与关卡在 [jumpMechanics.js](frontend/src/jumpMechanics.js)）。
- **摩斯拼词**：连跳落在「点/划」云上拼出字母 → 组成单词 → 触发秘技。
- **禁止越层跳**：只能落到紧邻的下一朵云；目标云绿色高亮，其后云朵透明度逐级降低（每远一朵 −0.32，最低 0.26）以强化节奏引导。

**秘技词（[jumpDict.js](frontend/src/jumpDict.js) 的 `SKILL_WORDS`）**

| 词 | 效果 |
|----|------|
| STAR | 流星雨 +50 |
| WIN | 下一跳必中 PERFECT |
| GOLD | 5 跳得分 ×2 |
| SOS | 复活护盾，挡一次落空 |
| SKY | 下一块变超宽桥 |
| FOX | 3 跳迷雾伪装云高 |
| OWL | 预览接下来 5 朵云 |
| MOON | 5 跳低重力飘升 |
| RAIN | 5 朵云自动变宽 |
| CODE | 自动纠错一次摩斯 |

另有约 90 个通用词（`COMMON_WORDS`）命中即加分 + 小特效。

**关卡难度曲线（海拔分层 `tierOf`）**

| 海拔 | 层级 | 新增机制 |
|------|------|----------|
| <350m | 晴空 | 基础 |
| <700m | 微风 | 中继站、侧风 |
| <1050m | 碎云 | 双频云、碎云、**尖刺云** |
| <1400m | 双频 | 干扰云、封蜡云 |
| <1800m | 迷雾 | 迷雾（隐藏符号）、听码云 |
| <2200m | 雷暴 | 雷暴闪烁、流星 |
| <2600m | 星流 | — |
| ≥2600m | 天门 | 登顶 3000m 通关 |

**云台变体（`applyPlatformVariant`）**：双频云（须跳对 ·/—）、碎云（1.1s 消散）、干扰云（显示假符号）、中继站（超宽 + 提示）、听码云（落台放摩斯）、封蜡云（需 PERFECT）、漂移云 + 侧风区、**尖刺云**（一侧长满尖刺，必须落安全侧 `spikeSafeRange` / `isImpaled` 判定）。

**无尽模式可复现**：布局用 `mulberry32` 固定种子（`lrandom/lrand/lchoice`），云路每局一致、可背板；粒子/眨眼等表现仍用真随机保持鲜活。

**寄信任务模式**：输入一个词生成专属关卡，逐字母摩斯拼词落位；通关触发主题庆祝特效（LOVE 爱心、SNOW 雪、RAIN 雨、STAR/MOON/DREAM/HOME/FIRE 等 8 主题 + 默认金色礼花），并可续接无尽模式。

**调试功能**：⋯ 菜单「管理员 · 无敌模式」（`godRef`），坠落自动救回当前云，防止结算失败。

---

### 3.3 关卡码 · 社交玩法

把寄信升级为「加密关卡码」社交玩法（编解码器 [jumpCode.js](frontend/src/jumpCode.js)）。

**A 玩家 · 出码**
- 在「✉ 寄一封信 · 出码」输入词，实时生成加密码（如 `LOVE → MC-F91V-XP`），一键复制分享。

**B 玩家 · 破译**
- 「🔓 破译关卡码」粘贴好友的码 → 解码校验 → 进入**保密关卡**（HUD 全程显示 `?`、失败也不泄露原词）。

**通关揭晓（两阶段）**
1. 封存态：先报「通关成功」+ 加密码。
2. 点「✨ 解密揭晓」→ 翻牌动画揭晓真词 + 对应主题特效。

**编码方案（纯前端自包含、可逆、非真加密）**
- Crockford base32 字符集（去除易混 I/L/O/U）。
- `body = [长度位] + [每字母：值 + 逐位置旋转盐] + [校验位]`，`MC-` 前缀 + 每 4 位短横分组。
- 逐位置旋转盐让同一字母在不同位置映射成不同字符，肉眼看不出规律；解码校验字符集 / 长度自洽 / A–Z 范围 / 校验位，任一不符即判非法（明文如 `LOVE` 会被正确拒绝）。

---

### 3.4 字母教学浮层

**入口**：信使「⋯」菜单 → 字母教学（`LearnScreen`，`learn` / `test` 双模）。

- **学习模式**：26 字母的摩斯点划展示 + 书写动画（[MorseLetterAnim.jsx](frontend/src/MorseLetterAnim.jsx) + [letterGlyphs.js](frontend/src/letterGlyphs.js) 字形剪影 + [letterPaths.js](frontend/src/letterPaths.js) 笔画坐标），按书写顺序点亮。
- **练习/测验模式**：手动发报（长按/短按电键），实时判定，答对上扬三音、答错下坠低鸣、连击金铃铛。
- **电键音**：[morseAudio.js](frontend/src/morseAudio.js) — 660Hz 正弦基频 + 2×/0.5× 泛音 + 5Hz LFO 轻微颤音 + 低通柔化，模拟温暖 CW 电报音。

---

### 3.5 剧情猜码

`PlayScreen`（代码保留、当前未挂载，可回滚）：基于 [data/static-quiz.json](data/static-quiz.json) 的「中文题面 + 四选一摩斯」剧情猜码关卡（如「小光和阿兴的星期日」故事线）。

---

## 4. 音乐合成链路（核心技术）

这是整个产品的技术核心：**让摩斯真正"蕴含"进歌里，而不是事后贴一段鼓点。**

### 4.1 设计演进

| 维度 | 旧方案 | 新方案（当前） |
|------|--------|----------------|
| 摩斯载体 | 前奏一段**无音高**鼓点 | 贯穿全曲、**有音高**的记忆动机 hook |
| 出现次数 | 仅开头一次 | 全曲循环（分段音量 + 副歌提亮） |
| 与 AI 音乐同步 | 各用各的 BPM，可能错拍 | librosa 探测真实拍点，**吸附对齐** |
| 副歌关系 | 无 | **sidechain** 轻压背景，让 hook 呼吸感浮现 |

### 4.2 音高化 hook（[drum_synth.py](backend/morse_api/drum_synth.py) `build_morse_hook`）

- **点（·）** = 八分音符短音，沿调式音阶级进上行（chattering 感）。
- **划（−）** = 更长的音，落在和弦音（根/三/五）上（锚定感）。
- 每个字母开头把旋律指针复位到根音，形成可辨识结构；字母间留半拍呼吸。
- 每种风格配专属调式/音色：治愈 = C 大调五声钢琴、电影 = D 小调铃、8-bit = E 大调五声、东方 = D 小调五声、梦境 = A 大调五声铃……

### 4.3 节拍/主调探测（[beat_align.py](backend/morse_api/beat_align.py)）

- `librosa.beat.beat_track` 探测 BPM 与拍点时间戳。
- 半/倍速修正：向目标 BPM 靠拢；偏差过大则信任目标 BPM（避免 librosa 误判）。
- Krumhansl 大小调模板 + chroma 估计主调。
- **可优雅降级**：librosa 缺失或探测失败时，回退到 prompt 指定 BPM，不阻断主流程。

### 4.4 全曲混音（[main.py](backend/morse_api/main.py) `_mix_hook_across_track`）

全程 NumPy 采样域运算（快且干净）：
1. 解码 AI 音乐为单声道 float，裁剪到 60s。
2. hook 循环填满全曲，每遍起点用 `snap_ms` 吸附到拍网格（超阈值不吸附，避免撕裂节奏）。
3. 分段音量：`intro`（清晰引入）→ `verse`（埋底若隐若现）→ `chorus`（提亮钻出）→ `outro`（回落）。
4. **副歌 sidechain**：在 hook 音符出现处，用向量化增益包络轻压背景（≈ −4.5dB），让 hook 呼吸感浮现。
5. 混合 → 峰值限幅 → 末尾 1.2s 淡出 → 导出 256k MP3。
6. 返回 `meta`：探测到的 BPM、主调、是否 detected、hook 重复次数。

### 4.5 大模型使用情况

| 模型 | 用途 | 是否必需 |
|------|------|----------|
| **music-2.6-free** | 生成底层纯器乐/带唱音频 | **必需**（核心产出） |
| **M2-her（文本）** | 写编曲提示词 | 可选，失败回退风格模板 |
| **M2-her（文本）** | 写歌词 | 仅「加入人声」时；失败回退简单模板 |

> 纯器乐模式（不勾人声）+ 文本 LLM 走 fallback 时，链路里唯一的"AI"就是音乐生成模型；摩斯编码、hook 旋律、节拍对齐、混音全是本地算法。

---

## 5. 后端 API 参考

基址：`http://127.0.0.1:8765`（开发期前端 Vite 代理 `/api` `/media` `/assets`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 原版「声印」单页（仅后端独立运行时；`static/index.html`） |
| GET | `/api/health` | 健康检查 `{ok, service}` |
| GET | `/api/styles` | 风格列表 `[{id, label}]` |
| GET | `/api/demo` | 碟中谍示例（内置时间轴，不走 AI；需 `assets/mission.mp3`） |
| GET | `/api/demo-horse` | 快乐小马 HORSE 示例（需 `assets/horse.mp3`） |
| POST | `/api/generate` | **同步**生成（阻塞，最长 300s；向后兼容保留） |
| POST | `/api/generate/start` | **异步**启动，立即返回 `{task_id}` |
| GET | `/api/generate/status/{task_id}` | 轮询进度：`{status, stage, stage_label, progress, result, error}` |
| GET | `/media/*` | 生成结果 MP3 |
| GET | `/assets/*` | 示例等静态文件 |

**生成请求体**
```json
{ "word": "LOVE", "style": "healing", "with_vocals": false }
```

**生成结果（`result` / 同步返回）关键字段**
```json
{
  "word": "LOVE",
  "morse_pretty": "·−·· −−− ···− ·",
  "style_label": "治愈钢琴",
  "audio_url": "/media/m_love_healing_inst_20260712_030705.mp3",
  "intro_duration_ms": 6000,
  "letter_timeline": [{ "letter": "L", "morse": ".-..", "start_ms": 0, "end_ms": 1250, "dot_effect": "...", "dash_effect": "..." }],
  "hook_key": "C 大调五声",
  "hook_bpm": 86.1,
  "beat_detected": true
}
```

**异步进度阶段**：`queued → encode → hook → prompt → (lyrics) → ai_music → align_mix → export → done`（对应中文标签：排队中 / 编码摩斯 / 合成记忆动机 / 构思编曲 / 谱写歌词 / AI 生成音乐 / 节拍对齐·混音 / 导出音频 / 完成）。

---

## 6. 关键技术实现

### 6.1 前端

- **状态保活的 Tab 切换**：三个 panel 全程挂载，仅用 `display` 切换 → 生成中途切走再回来仍保留表单/进度/播放状态。
- **异步生成 + 轮询**：`/api/generate/start` 拿 `task_id` → 每 1s 轮询 status → 更新进度条与阶段标签；后端不支持异步时自动回退老的同步接口（`__NO_ASYNC__` 分支）。
- **Web Audio 即时预览**：客户端用 `AudioContext` 合成音高化 hook（`STYLE_KEY` 与后端 `styles.py` 调式一一对齐），零延迟、不消耗生成额度。
- **游戏渲染**：Canvas 2D + `requestAnimationFrame`；世界坐标 `alt → 屏幕Y`（`altToScreenY`，锚点 `CHAR_ANCHOR_Y=0.66`）。
- **落点判定**：`findLandingCloud` 只落紧邻下一朵（`ceilY` 上限禁越层）；尖刺云用 `isImpaled` 判致命侧。

### 6.2 后端

- **异步任务表**：内存 `_TASKS` 字典 + `threading.Lock` + daemon 线程；30 分钟 TTL 自动 GC。进度通过 `progress_cb` 回调写入任务表。
- **ffmpeg 兜底**：系统无 ffmpeg 时用 pip 的 `static-ffmpeg` 自动注册到 PATH（pydub 解码 MP3 依赖）。
- **密钥加载**：环境变量 `MINIMAX_API_KEY` 优先，否则 `key.json`（支持纯文本 / `api_key` / `bearer_token` / `group_id` 拼接等写法）。
- **MiniMax 错误码**：客户端对 1002 限流 / 1004·2049 鉴权 / 1008 余额 / 2013 参数 / 1026 内容策略 等做中文提示。

### 6.3 硬约束

- 生成歌曲统一裁剪至**前 60 秒**，末尾 **1.2s 淡出**。
- 输入词：**1–10 个字母（A–Z）**，服务端校验。
- 音频输出：44.1kHz / 256kbps / MP3。

---

## 7. 目录结构与文件职责

```
final0710/
├── start.py / start.sh / 一键启动.command   # 一键启动（先后端后前端，自动 npm install）
├── app.py                                    # 备用入口
├── README.md / PRODUCT.md / PROGRAM.md       # 已有文档（README=运行，PRODUCT=产品叙事）
├── DOCUMENTATION.md                          # 本文档
├── data/static-quiz.json                     # 剧情猜码题库
├── frontend/
│   ├── vite.config.js                        # 端口 5173 + /api /media /assets 代理到 8765
│   ├── src/
│   │   ├── App.jsx                (3379 行)   # Tab 路由 / MusicScreen / LearnScreen / 全局音效
│   │   ├── JumpGame.jsx           (4070 行)   # 星途信使游戏主体（渲染/物理/关卡码/特效）
│   │   ├── jumpMechanics.js       (243 行)    # 关卡机制、难度曲线、云台变体、尖刺几何
│   │   ├── jumpDict.js            (124 行)    # 秘技词 / 通用词 / 前缀联想
│   │   ├── jumpCode.js            (94 行)     # 关卡码可逆编解码
│   │   ├── morseAudio.js          (107 行)    # Web Audio CW 电键音
│   │   ├── MorseLetterAnim.jsx    (224 行)    # 字母书写动画
│   │   ├── letterGlyphs.js        (2031 行)   # 26 字母字形剪影
│   │   ├── letterPaths.js         (39 行)     # 笔画坐标
│   │   └── api.js                             # apiUrl / API_BASE
│   └── public/                               # 字母视频 / mission-demo.json
└── backend/
    ├── requirements.txt                      # numpy/pydub/fastapi/uvicorn/static-ffmpeg/librosa
    ├── MUSIC_PIPELINE.md                     # 音乐链路设计说明
    └── morse_api/
        ├── main.py            (743 行)       # FastAPI 路由 + 异步任务 + 全曲 hook 混音
        ├── drum_synth.py      (776 行)       # 鼓点前奏 + 音高化 hook + 乐器音色合成
        ├── minimax_client.py  (518 行)       # 文本 LLM + 音乐模型对接
        ├── beat_align.py      (221 行)       # librosa 节拍/主调探测 + 网格吸附
        ├── styles.py          (242 行)       # 12 种风格档位
        ├── morse_codec.py     (81 行)        # 词 → 摩斯
        ├── config.py          (80 行)        # 集中配置
        ├── key_loader.py      (53 行)        # MiniMax 密钥加载
        ├── key.json                          # 密钥（勿提交）
        ├── static/index.html                 # 原版声印单页
        └── assets/                           # mission.mp3 / horse.mp3 示例
```

---

## 8. 部署与运行

### 8.1 一键启动（macOS，推荐）
```bash
cd /你的路径/final0710
python3 start.py          # 自动起后端 :8765，再起前端 :5173（首次自动 npm install）
```
浏览器访问 **http://127.0.0.1:5173**。

### 8.2 分终端手动开发
```bash
# 终端 1 —— 后端
cd backend
python3 -m pip install -r requirements.txt
export MINIMAX_API_KEY="你的密钥"      # 或写入 backend/morse_api/key.json
python3 -m morse_api                    # → http://127.0.0.1:8765

# 终端 2 —— 前端
cd frontend
npm install
npm run dev                             # → http://127.0.0.1:5173
```

### 8.3 依赖要点
- **Python 3.8+**：fastapi / uvicorn / numpy / pydub / librosa / static-ffmpeg。
- **Node**：Vite 6 + React 18 + Tailwind 3。
- **ffmpeg**：建议 `brew install ffmpeg`；缺失时 `static-ffmpeg` 兜底。
- **MiniMax Key**：开放平台 → 用户中心 → 接口密钥。
- **示例音频**：`backend/morse_api/assets/mission.mp3`（碟中谍示例需要）。

### 8.4 生产/无代理预览
- 一体化部署：设 `MORSE_SPA_DIST=/abs/path/to/frontend/dist`，后端直接托管前端静态站。
- 无代理预览前端：`frontend/.env` 设 `VITE_API_BASE=http://127.0.0.1:8765`。

---

## 9. 降级与容错设计

产品在多处做了「优雅降级」，保证核心链路不因单点失败而中断：

| 失败点 | 降级策略 |
|--------|----------|
| 文本 LLM 写提示词失败 | 回退到风格 `fallback_prompt` 模板 |
| 文本 LLM 写歌词失败 | 回退到 `build_lyrics_from_morse` 简单模板 |
| librosa 未安装 / 探测失败 | 回退到 prompt 指定 BPM，均匀网格对齐 |
| 探测 BPM 无效（0/NaN/极端） | 回退目标 BPM；半倍速修正 |
| 全曲 hook 混音异常 | 回退到旧版「前奏鼓点叠加」`_mix_intro_drums_with_music` |
| ffmpeg 缺失 | `static-ffmpeg` 自带二进制注册到 PATH |
| 前端异步接口不可用（404） | 自动回退老的同步 `/api/generate` |
| Web Audio 不支持 | 预览静默跳过，不影响正式生成 |

---

*文档基于当前代码实现整理。核心亮点：摩斯不再是"贴上去的鼓点"，而是经调式化、节拍对齐、副歌 sidechain 后真正"长进"整首歌的记忆动机。*
