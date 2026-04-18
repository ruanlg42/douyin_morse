# 摩斯鼓点 × MiniMax Music-Cover 端到端 Demo 说明

## 如何使用本 Demo

在仓库 **`backend/` 目录**（含 `requirements.txt` 与 `morse_api` 包）下按顺序操作即可跑通 CLI 全流程。

1. **安装依赖**：`cd backend && pip install -r requirements.txt`
2. **准备 MiniMax 密钥**（任选其一）  
   - 环境变量：`export MINIMAX_API_KEY="你的密钥"`  
   - 或在 `backend/morse_api/key.json`（格式见下文「7. API Key 配置」）
3. **MP3 导出（推荐）**：系统需安装 `ffmpeg` 并在 `PATH` 中；未安装时鼓点会降级为 WAV，MiniMax 仍可接受。
4. **运行**（需有效 Key 与网络；将 `Lucas` 换成 10 个字母以内的英文缩写）：

```bash
cd /path/to/repo/backend
python -m morse_api.run_demo --abbrev Lucas
```

5. **结果位置**：默认写入 `outputs/`，例如 `lucas_<YYYYMMDD_HHMMSS>_morse_drum.mp3`（鼓点参考）与同名时间戳的 `_morse_music.mp3`（Cover 成品）。

**常用参数**：只生成摩斯 + 鼓点、不调 API：`--skip-api`；生成后不自动播放：`--no-play`；更详细日志：`--verbose`。更多示例见下文「8. 运行命令」。

---

下文说明 `morse_api` 包的设计思路、数据流、节奏映射与 MiniMax 对接方式，便于阅读代码、调试与二次扩展。

## 1. 目标与创意

用户输入 **10 个字母以内**的英文缩写（默认 `Lucas`），程序完成：

1. **缩写 → 摩斯**：每个字母转为标准摩斯点划；**字母之间用一个空格**表示休止（与题目示例一致）。
2. **摩斯 → 鼓点**：把「·」映射为短击、「−」映射为长击、空格映射为字母间休止，生成 **仅鼓点** 的参考音频。
3. **鼓点 → 完整纯音乐**：调用 MiniMax **`music-cover-free`**（可改为 `music-cover`），以 `audio_base64` 上传参考音频，要求模型 **严格保留鼓点节奏/速度/结构**，生成温柔治愈向 **钢琴 + 轻弦乐** 纯音乐。
4. **落盘与调试播放**：输出 `{缩写小写}_{YYYYMMDD_HHMMSS}_morse_drum.mp3` 与同名时间戳的 `_morse_music.mp3`，避免覆盖、便于区分批次，可选自动播放。

官方接口文档：[Music Generation API](https://platform.minimax.io/docs/api-reference/music-generation)

## 2. 目录与模块

| 模块 | 职责 |
|------|------|
| `config.py` | BPM、采样率、目标时长、模型名、`api_base`、输出比特率等集中配置 |
| `morse_codec.py` | 校验缩写、查表生成摩斯字符串（点划 + 可视化 `·` `−`） |
| `drum_synth.py` | 按 BPM 将摩斯展开为时间线，合成短鼓/长鼓，循环与按小节对齐，导出 MP3（或 WAV 兜底） |
| `key_loader.py` | 从 `key.json` 解析 Bearer Token（支持 `group_id` 拼接等常见写法） |
| `minimax_client.py` | `POST /v1/music_generation`，`audio_base64` 上传，`output_format=hex` 解码 |
| `main.py` | FastAPI：`/api/*`、`/media`、`/assets` |
| `player.py` | macOS `afplay` / Windows `start` / Linux `xdg-open` 简单播放 |
| `run_demo.py` | CLI 入口，串联全流程与日志 |

## 3. 摩斯编码规则

- 仅允许 **A–Z**（缩写场景）；规范化后为全大写。
- **字母之间**：在内部字符串里用 **单个空格** 分隔各字母的摩斯片段，例如 `Lucas` →  
  `.-.. .. -.-. .- ...`
- 控制台额外打印「可视化」行，将 `.` / `-` 替换为 `·` / `−`，便于和题目描述对照。

## 4. 鼓点节奏映射（核心）

在 **4/4 拍**、**BPM=80**（可在 `DemoConfig` 修改）下：

- **一拍时长** \(= 60 / \text{BPM}\) 秒。
- **16 分音符时长** \(= \frac{1}{4}\) 拍 → 用作 **短音（·）** 的鼓击长度。
- **二分音符时长** \(= 2\) 拍 → 用作 **长音（−）** 的鼓击长度。  
  因而在乐理上 **长音 = 8 × 短音**（16 分与二分的关系），而不是电信摩斯里常见的 1:3 时长比。

其它时间：

- **同一字母内**，点划之间：**1 个 16 分休止**。
- **字母与字母之间**（对应摩斯串里的空格）：**3 个 16 分休止**（与经典摩斯「字母间隔 ≈ 3 个点划单位」一致）。

### 音色

- **短音**：短噪声 + 弱高频正弦，听感接近 **拍手 / 紧小鼓**。
- **长音**：带快速音高下潜的正弦包络，听感接近 **重底鼓**。

随机种子固定（`DemoConfig.drum_seed`），便于复现同一缩写的鼓点质感。

### 循环与「小节」

题目希望 **10–20 秒**、并提到 **8–16 小节循环**。在 BPM=80 时，**每小节 ≈ 3 秒**（四拍），因此 **8 小节 ≈ 24 秒**，与 10–20 秒上限 **无法同时严格成立**。本实现 **优先满足 10–20 秒** 与 MiniMax 参考音频 **6 秒–6 分钟** 约束：

1. 先合成「单遍缩写」鼓型；
2. **重复**至时长落在 `[drum_target_min_sec, drum_target_max_sec]`（默认 10–20 秒）；
3. 再 **末尾补零**对齐到 **整数小节**，方便循环听感一致；
4. 在日志中打印「约多少小节」，便于你对照节拍。

若你需要「严格 8 小节」，可改为放宽时长上限或提高 BPM，在 `config.py` 调整即可。

## 5. MiniMax API 对接要点

- **端点**：`{MINIMAX_API_BASE}/v1/music_generation`  
  默认 `MINIMAX_API_BASE=https://api.minimax.io`；若网络环境需要，可设环境变量为 `https://api.minimaxi.com`（与旧示例一致）。
- **模型**：默认 `music-cover-free`（调试友好）；正式额度可改为 `music-cover`。
- **参考音频**：请求体字段 **`audio_base64`**，内容为 **整个鼓点文件**（MP3 或兜底 WAV）的 Base64。**无需**自建公网 URL。
- **输出**：`output_format: "hex"`，`data.audio` 为十六进制字符串，脚本 `binascii.unhexlify` 后写入 `{缩写}_{时间戳}_morse_music.mp3`。
- **输出音质**：`audio_setting` 中 `sample_rate: 44100`，`bitrate: 256000`，`format: "mp3"`（与题目一致）。
- **Prompt**：`minimax_client.build_cover_prompt()` 中集中维护，长度满足 **10–300 字符** 的 music-cover 限制；强调 **保留参考鼓点节奏、速度、结构** 与 **温柔治愈钢琴 + 轻弦乐、纯器乐**。

### 常见错误码（`base_resp.status_code`）

客户端对以下码做了中文说明（详见 `minimax_client.py`）：

- `1002` 限流  
- `1004` / `2049` 鉴权或 Key 问题  
- `1008` 余额  
- `2013` 参数非法（参考音频过大、过短、prompt 长度等）  
- `1026` 内容策略  

若 `data.status == 1` 且无 `audio`，表示生成仍在进行；当前 OpenAPI 片段未提供标准轮询字段，脚本会抛出明确错误，建议你 **稍后重试**。

## 6. 依赖与环境

```bash
cd /path/to/repo/backend
pip install -r requirements.txt
```

- **MP3 导出**：`pydub` 依赖系统 **`ffmpeg` 在 PATH 中**。  
  - macOS：`brew install ffmpeg`  
  - Windows：安装 ffmpeg 并加入 PATH  

若 MP3 导出失败，鼓点会自动 **降级为 WAV**（`*_morse_drum.wav`）；MiniMax 仍接受 WAV 作为参考音频。

## 7. API Key 配置

任选其一：

1. **环境变量**（推荐）：`export MINIMAX_API_KEY="你的密钥"`
2. **文件**：`morse_api/key.json`（在 `backend/` 下相对路径），支持纯文本一行 Key，或 JSON 字段 `api_key` / `bearer_token` 等（见 `key_loader.py`）。

获取路径：**MiniMax 开放平台 → 用户中心 → 接口密钥**  
<https://platform.minimax.io/user-center/basic-information/interface-key>

## 8. 运行命令

```bash
# 全流程（需有效 Key 与网络）
python -m morse_api.run_demo --abbrev Lucas

# 只生成摩斯 + 鼓点，调节奏用
python -m morse_api.run_demo --abbrev Lucas --skip-api

# 生成后不自动播放
python -m morse_api.run_demo --abbrev Lucas --no-play

# 更详细日志
python -m morse_api.run_demo --abbrev Lucas --verbose

# 自定义节奏：更快的 BPM 与更短的长音
python -m morse_api.run_demo --abbrev Lucas --bpm 140 --dash-ratio 2.0
```

输出默认在 `outputs/`，例如：`lucas_20260415_153045_morse_drum.mp3` 与 `lucas_20260415_153045_morse_music.mp3`（缩写小写 + 本地生成时间 `YYYYMMDD_HHMMSS`）。

## 9. 可扩展建议

- **BPM / 鼓音色**：只改 `DemoConfig` 与 `drum_synth.py` 中合成函数即可。
- **模型切换**：`cover_model = "music-cover"`，注意额度与 RPM。
- **Prompt 语言**：可改为英文描述，但需保持 10–300 字符与「保留节奏」语义。

## 10. 已知限制与说明

- **music-cover** 类模型会对参考音频做 **ASR/编曲层面** 的理解，无法像 DAW 一样「逐采样锁定」；Prompt 的作用是尽量约束 **节奏与结构不被改掉**，实际效果以线上模型为准。
- **电信摩斯 1:3** 与 **乐理 16 分 vs 二分（1:8）** 不一致时，本 Demo 通过 `DemoConfig.dash_ratio` 控制长/短音倍数（默认 4.0，即四分音符 vs 16 分音符）；若希望严格电信比例可设为 `3.0`，更贴近原题 1:2 可设为 `2.0`，CLI 也提供 `--dash-ratio`。

---

以上即为端到端实现的设计说明；若你接下来希望接入 **GUI**、**实时试听** 或 **多轨 MIDI 导出**，可以在现有模块边界上继续加层，而无需改动 MiniMax 调用核心逻辑。
