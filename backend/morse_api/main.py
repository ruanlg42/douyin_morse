"""
FastAPI 服务（与历史包 generate_morse_music.app_mobile 对齐）：

- GET / → static/index.html（原版「声印」单页试玩，同 generate_morse_music/static）
- /api/*、/media、/assets 与一体化前端（frontend/）共用

完整三 Tab 应用请用根目录 start.py；仅想试声印时可只起后端并打开 http://127.0.0.1:8765/
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from pathlib import Path

from dataclasses import replace
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import PACKAGE_DIR, load_config
from .drum_synth import (
    effect_for_voice,
    floats_to_wav_bytes_mono,
    render_intro_drums_with_timeline,
    render_morse_hook_with_timeline,
)
from . import beat_align
from .key_loader import load_bearer_token
from .minimax_client import (
    MiniMaxAPIError,
    generate_instrumental_prompt_for_name,
    generate_lyrics_for_name,
    music_cover_from_base64,
)
from .morse_codec import abbrev_to_morse
from .styles import list_styles, resolve as resolve_style

logger = logging.getLogger(__name__)

# 确保 pydub 能找到 ffmpeg/ffprobe（混音解码 MP3 依赖）。
# 系统未装 ffmpeg 时，用 pip 安装的 static-ffmpeg 自带二进制注册到 PATH。
import shutil as _shutil

if _shutil.which("ffmpeg") is None or _shutil.which("ffprobe") is None:
    try:
        import static_ffmpeg  # type: ignore

        static_ffmpeg.add_paths()
        logger.info("static-ffmpeg 已注册到 PATH：ffmpeg=%s", _shutil.which("ffmpeg"))
    except Exception as _e:  # noqa: BLE001
        logger.warning("未找到 ffmpeg，且 static-ffmpeg 不可用：%s（生成将失败）", _e)

STATIC_DIR = PACKAGE_DIR / "static"
OUTPUT_DIR = PACKAGE_DIR / "outputs"
ASSETS_DIR = PACKAGE_DIR / "assets"

STATIC_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """与 generate_morse_music 一致：提示本机用 127.0.0.1，勿用 0.0.0.0 访问。"""
    port = os.environ.get("PORT", "8765")
    print(
        "\n  ┌─ 本机请在浏览器打开（勿使用 http://0.0.0.0:" + port + "）────────\n"
        "  │  声印单页：http://127.0.0.1:" + port + "/\n"
        "  │  完整 App：另开终端 cd frontend && npm run dev → http://127.0.0.1:5173\n"
        "  └─ 手机同一 WiFi：http://<电脑局域网IP>:" + port + "/\n"
    )
    yield


app = FastAPI(title="摩斯前奏 · 手机试玩", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


def _spa_frontend_dist() -> Optional[Path]:
    """一体化前端构建目录（如 Docker / ModelScope 部署）。设置 MORSE_SPA_DIST=/abs/path/to/frontend/dist"""
    raw = os.environ.get("MORSE_SPA_DIST", "").strip()
    if not raw:
        return None
    p = Path(raw).expanduser().resolve()
    if p.is_dir() and (p / "index.html").is_file():
        return p
    return None


_SPA_FRONTEND = _spa_frontend_dist()

_MISSION_INTRO_OFFSET_MS = 1600
_MISSION_M_REL = (0, 750)
_MISSION_I_REL = (850, 1400)
_MISSION_CYCLE_MS = 1600
_MISSION_CYCLES = 8
_MISSION_DISPLAY_PHRASE = "Mission: Impossible"


def _build_mission_timeline() -> tuple[list[dict], int]:
    m_hero = _MISSION_DISPLAY_PHRASE.find("M")
    i_hero = _MISSION_DISPLAY_PHRASE.find("I")
    tl: list[dict] = []
    split = _MISSION_CYCLES // 2
    for n in range(_MISSION_CYCLES):
        base = _MISSION_INTRO_OFFSET_MS + n * _MISSION_CYCLE_MS
        eff = "bloom" if n < split else "hit"
        tl.append(
            {
                "letter": "M",
                "morse": "--",
                "morse_pretty": "−−",
                "start_ms": base + _MISSION_M_REL[0],
                "end_ms": base + _MISSION_M_REL[1],
                "hero_idx": m_hero,
                "dot_effect": eff,
                "dash_effect": eff,
            }
        )
        tl.append(
            {
                "letter": "I",
                "morse": "..",
                "morse_pretty": "··",
                "start_ms": base + _MISSION_I_REL[0],
                "end_ms": base + _MISSION_I_REL[1],
                "hero_idx": i_hero,
                "dot_effect": eff,
                "dash_effect": eff,
            }
        )
    intro_ms = _MISSION_INTRO_OFFSET_MS + _MISSION_CYCLES * _MISSION_CYCLE_MS + 400
    return tl, intro_ms


_MISSION_TIMELINE, _MISSION_INTRO_MS = _build_mission_timeline()

_MISSION_DEMO = {
    "word": "MI",
    "display_phrase": _MISSION_DISPLAY_PHRASE,
    "morse_pretty": "−− / ··",
    "style_label": "碟中谍主题曲",
    "with_vocals": False,
    "audio_url": "/assets/mission.mp3",
    "intro_duration_ms": _MISSION_INTRO_MS,
    "intro_anim_delay_ms": 6000,
    "letter_timeline": _MISSION_TIMELINE,
    "demo": True,
    "demo_caption": f"主题曲前奏里 —— M（−−）+ I（··），循环 {_MISSION_CYCLES} 次",
}


_HORSE_DISPLAY_PHRASE = "快乐小马 HORSE"


def _build_horse_demo_payload() -> dict:
    """内置「快乐小马」示例元数据：摩斯为 HORSE；需 assets/horse.mp3。"""
    cfg = load_config()
    style = resolve_style("folk_acoustic")
    if style.bpm_hint:
        cfg = replace(cfg, bpm=int(style.bpm_hint))

    morse = abbrev_to_morse("HORSE")
    _, intro_ms, intervals = render_intro_drums_with_timeline(
        morse.morse_dot_dash,
        cfg,
        short_voice=style.drum_voices[0],
        long_voice=style.drum_voices[1],
    )
    dot_effect = effect_for_voice(style.drum_voices[0])
    dash_effect = effect_for_voice(style.drum_voices[1])
    letters = list(morse.abbrev_normalized)
    hero_base = len(_HORSE_DISPLAY_PHRASE) - len(morse.abbrev_normalized)
    letter_timeline: list[dict] = []
    for i, iv in enumerate(intervals):
        letter_timeline.append(
            {
                "letter": letters[i] if i < len(letters) else "",
                "morse": iv["morse"],
                "morse_pretty": iv["morse"].replace(".", "·").replace("-", "−"),
                "start_ms": iv["start_ms"],
                "end_ms": iv["end_ms"],
                "hero_idx": hero_base + i,
                "dot_effect": dot_effect,
                "dash_effect": dash_effect,
            }
        )
    return {
        "word": morse.abbrev_normalized,
        "display_phrase": _HORSE_DISPLAY_PHRASE,
        "morse_pretty": morse.morse_pretty,
        "style_label": "快乐小马主题（HORSE 摩斯）",
        "with_vocals": False,
        "audio_url": "/assets/horse.mp3",
        "intro_duration_ms": intro_ms,
        "letter_timeline": letter_timeline,
        "demo": False,
        "dot_effect": dot_effect,
        "dash_effect": dash_effect,
        "demo_caption": "前奏为 HORSE 五字母摩斯；生成提示词要求包含「快乐小马」",
    }


_HORSE_DEMO = _build_horse_demo_payload()


class GenerateBody(BaseModel):
    word: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description="任意英文词（名字、love 等），仅字母，最多 10 个由服务端校验",
    )
    style: Optional[str] = Field(default=None, description="风格 id，留空则用默认")
    with_vocals: bool = Field(default=False, description="是否加入主唱人声")
    name: Optional[str] = Field(default=None, exclude=True)  # 旧前端字段，向后兼容


def _resolve_api_key() -> str:
    env_k = os.environ.get("MINIMAX_API_KEY", "").strip()
    if env_k:
        return env_k
    kf = Path(load_config().key_file).resolve()
    return load_bearer_token(kf)


def _mix_intro_drums_with_music(
    intro_wav_bytes: bytes,
    music_mp3_bytes: bytes,
    drum_overlay_db: float = -10.0,
) -> bytes:
    from pydub import AudioSegment

    drums = AudioSegment.from_file(BytesIO(intro_wav_bytes), format="wav")
    music = AudioSegment.from_file(BytesIO(music_mp3_bytes), format="mp3")
    intro_ms = len(drums)

    try:
        shaped = drums.low_pass_filter(6500).high_pass_filter(80)
    except Exception:
        shaped = drums

    fade_out_ms = max(700, min(2000, intro_ms // 3))
    fade_in_ms = min(250, intro_ms // 8)
    layer = (shaped + drum_overlay_db).fade_in(fade_in_ms).fade_out(fade_out_ms)

    if len(music) < intro_ms:
        music = music + AudioSegment.silent(duration=intro_ms - len(music))
    head = music[:intro_ms].overlay(layer)
    tail = music[intro_ms:]
    out = head + tail

    # 只保留前 60 秒；若超时则在末尾加一小段淡出，避免生硬截断
    MAX_MS = 60_000
    if len(out) > MAX_MS:
        out = out[:MAX_MS].fade_out(1200)

    buf = BytesIO()
    out.export(buf, format="mp3", bitrate="256k")
    return buf.getvalue()


# 全曲结构分段（相对总时长的比例）与各段 hook 音量(dB, 相对 base_overlay_db 基线)
# intro：清晰引入；verse：埋底若隐若现；chorus：提亮钻出；outro：回落
_SECTION_PLAN = [
    ("intro", 0.00, 0.16, 9.0),
    ("verse", 0.16, 0.42, -3.0),
    ("chorus", 0.42, 0.66, 5.0),
    ("verse", 0.66, 0.82, -3.0),
    ("chorus", 0.82, 0.96, 6.0),
    ("outro", 0.96, 1.00, 0.0),
]


def _db_to_gain(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def _seg_to_mono_float(seg, sr: int):
    """pydub AudioSegment → 单声道 float32 [-1,1]，并重采样到 sr。"""
    import numpy as np

    seg = seg.set_frame_rate(sr).set_channels(1).set_sample_width(2)
    arr = np.array(seg.get_array_of_samples(), dtype=np.float32) / 32768.0
    return arr


def _mix_hook_across_track(
    hook_wave,
    hook_notes: list[dict],
    hook_ms: int,
    music_mp3_bytes: bytes,
    *,
    sample_rate: int,
    base_overlay_db: float = -12.0,
    target_bpm: Optional[int] = None,
) -> tuple[bytes, dict]:
    """
    把「音高化摩斯 hook」按全曲结构铺设并叠入 AI 音乐（全程 numpy 采样域运算，快且干净）：
    - librosa 探测成品真实 BPM/拍点/主调；
    - hook 循环填满全曲，每遍起点吸附到最近拍网格；
    - 分段音量（intro/verse/chorus/outro）让 hook 若隐若现地贯穿全曲；
    - 副歌处对背景做 sidechain 轻压，让 hook 呼吸感浮现；
    - 保留 60s 裁剪 + 末尾淡出。

    Returns:
        (mp3_bytes, meta)  meta 含探测 bpm/key/是否 detected、hook 出现次数等。
    """
    import numpy as np
    from pydub import AudioSegment

    sr = sample_rate
    music_seg = AudioSegment.from_file(BytesIO(music_mp3_bytes), format="mp3")
    MAX_MS = 60_000
    if len(music_seg) > MAX_MS:
        music_seg = music_seg[:MAX_MS]
    total_ms = len(music_seg)

    music = _seg_to_mono_float(music_seg, sr)
    n_total = music.shape[0]

    # 1) 探测节拍/调式
    info = beat_align.analyze_track(music_mp3_bytes, target_bpm=target_bpm)
    grid = beat_align.build_grid_ms(info, total_ms, subdivision=2)

    # 2) hook 波形（float mono）；轻微高通让出低频
    hook = np.asarray(hook_wave, dtype=np.float32)

    # 3) 铺设 hook：每遍起点吸附到拍网格，写入 hook_layer（含分段音量）
    hook_layer = np.zeros(n_total, dtype=np.float32)
    gap_ms = max(400, int(hook_ms * 0.5))
    period_ms = max(1, hook_ms + gap_ms)

    def _section_db(pos_ms: float) -> float:
        for _name, a, b, seg_db in _SECTION_PLAN:
            if total_ms * a <= pos_ms < total_ms * b:
                return seg_db
        return 0.0

    all_hook_note_starts: list[float] = []
    t = 0.0
    hook_repeats = 0
    while t < total_ms - hook_ms * 0.5:
        snapped = beat_align.snap_ms(t, grid, max_shift_ms=90.0)
        seg_gain = _db_to_gain(base_overlay_db + _section_db(snapped))
        start = int(round(snapped / 1000.0 * sr))
        end = min(n_total, start + hook.shape[0])
        if end > start:
            hook_layer[start:end] += hook[: end - start] * seg_gain
        for note in hook_notes:
            all_hook_note_starts.append(snapped + float(note["start_ms"]))
        hook_repeats += 1
        t = snapped + period_ms

    # 4) 副歌 sidechain：hook 音符出现处轻压背景（采样域增益包络，向量化）
    duck = np.ones(n_total, dtype=np.float32)
    attack = max(1, int(0.03 * sr))
    release = max(1, int(0.22 * sr))
    depth = _db_to_gain(-4.5)  # 压到约 -4.5dB
    # 预生成单个「压低-恢复」窗（1→depth→1）
    dip = np.concatenate([
        1.0 - (1.0 - depth) * np.linspace(0.0, 1.0, attack, dtype=np.float32),
        1.0 - (1.0 - depth) * np.linspace(1.0, 0.0, release, dtype=np.float32),
    ])
    chorus_ranges = [(total_ms * a, total_ms * b) for nm, a, b, _ in _SECTION_PLAN if nm == "chorus"]
    for ev in all_hook_note_starts:
        if not any(lo <= ev < hi for lo, hi in chorus_ranges):
            continue
        c = int(ev / 1000.0 * sr) - attack
        s = max(0, c)
        e = min(n_total, c + dip.shape[0])
        if e > s:
            w = dip[s - c: e - c]
            duck[s:e] = np.minimum(duck[s:e], w)
    music = music * duck

    # 5) 混合 + 限幅 + 淡出
    out = music + hook_layer
    peak = float(np.max(np.abs(out))) or 1.0
    if peak > 0.99:
        out = out * (0.99 / peak)
    # 末尾 1.2s 淡出
    fade_n = min(n_total, int(1.2 * sr))
    if fade_n > 0:
        out[-fade_n:] *= np.linspace(1.0, 0.0, fade_n, dtype=np.float32)

    out16 = np.clip(out, -1.0, 1.0)
    wav_bytes = floats_to_wav_bytes_mono(out16, sr)
    seg = AudioSegment.from_file(BytesIO(wav_bytes), format="wav")
    buf = BytesIO()
    seg.export(buf, format="mp3", bitrate="256k")
    meta = {
        "detected_bpm": info.bpm,
        "detected_key": f"{info.root} {info.scale}",
        "beat_detected": info.detected,
        "hook_repeats": hook_repeats,
        "total_ms": total_ms,
    }
    return buf.getvalue(), meta


def _run_generate(
    word: str,
    style_id: Optional[str],
    with_vocals: bool = False,
    *,
    theme_cn: Optional[str] = None,
    asset_basename: Optional[str] = None,
    progress_cb=None,
) -> dict:
    def _progress(stage: str, pct: int) -> None:
        if progress_cb:
            try:
                progress_cb(stage, pct)
            except Exception:  # noqa: BLE001
                pass

    cfg = load_config()
    style = resolve_style(style_id)
    if style.bpm_hint:
        cfg = replace(cfg, bpm=int(style.bpm_hint))
    target_bpm = int(style.bpm_hint) if style.bpm_hint else int(cfg.bpm)

    _progress("encode", 8)
    morse = abbrev_to_morse(word.strip())

    # 摩斯前奏鼓点（保留：给前端做逐字母时间轴 + intro 时长）
    intro_wav, intro_ms, intervals = render_intro_drums_with_timeline(
        morse.morse_dot_dash,
        cfg,
        short_voice=style.drum_voices[0],
        long_voice=style.drum_voices[1],
    )

    dot_effect = effect_for_voice(style.drum_voices[0])
    dash_effect = effect_for_voice(style.drum_voices[1])

    letters = list(morse.abbrev_normalized)
    letter_timeline: list[dict] = []
    for i, iv in enumerate(intervals):
        letter_timeline.append(
            {
                "letter": letters[i] if i < len(letters) else "",
                "morse": iv["morse"],
                "morse_pretty": iv["morse"].replace(".", "·").replace("-", "−"),
                "start_ms": iv["start_ms"],
                "end_ms": iv["end_ms"],
                "dot_effect": dot_effect,
                "dash_effect": dash_effect,
            }
        )

    # 音高化摩斯 hook（贯穿全曲的记忆动机），用目标 BPM 与风格调式
    _progress("hook", 18)
    hook_wave, hook_notes, hook_ms = render_morse_hook_with_timeline(
        morse.morse_dot_dash,
        cfg,
        root=style.key_root,
        scale=style.key_scale,
        octave=style.hook_octave,
        timbre=style.hook_timbre,
        bpm=target_bpm,
    )

    scale_cn = {
        "minor": "小调", "major": "大调", "minor_pent": "小调五声",
        "major_pent": "大调五声", "dorian": "多利亚调式",
    }.get(style.key_scale, "小调")
    key_desc = f"{style.key_root} {scale_cn}"

    api_key = _resolve_api_key()
    _progress("prompt", 30)
    music_prompt, prompt_from_llm = generate_instrumental_prompt_for_name(
        cfg,
        api_key,
        abbrev=morse.abbrev_normalized,
        morse_dot_dash=morse.morse_dot_dash,
        morse_pretty=morse.morse_pretty,
        style_label=style.label,
        style_hint=style.music_hint,
        fallback_prompt=style.fallback_prompt,
        with_vocals=with_vocals,
        theme_cn=theme_cn,
        target_bpm=target_bpm,
        key_desc=key_desc,
    )

    lyrics: Optional[str] = None
    lyrics_from_llm = False
    if with_vocals:
        _progress("lyrics", 40)
        lyrics, lyrics_from_llm = generate_lyrics_for_name(
            cfg,
            api_key,
            abbrev=morse.abbrev_normalized,
            style_label=style.label,
            style_hint=style.music_hint,
            fallback_morse=morse.morse_dot_dash,
        )

    _progress("ai_music", 55)
    music_bytes = music_cover_from_base64(cfg, api_key, "", music_prompt, lyrics=lyrics)

    _progress("align_mix", 82)
    try:
        mixed, mix_meta = _mix_hook_across_track(
            hook_wave,
            hook_notes,
            hook_ms,
            music_bytes,
            sample_rate=cfg.sample_rate,
            base_overlay_db=style.drum_overlay_db,
            target_bpm=target_bpm,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("全曲 hook 混音失败，回退到前奏鼓点叠加：%s", e)
        mixed = _mix_intro_drums_with_music(intro_wav, music_bytes, drum_overlay_db=style.drum_overlay_db)
        mix_meta = {"fallback": True}

    logger.info(
        "music_prompt_from_llm=%s  with_vocals=%s  lyrics_from_llm=%s  mix=%s",
        prompt_from_llm,
        with_vocals,
        lyrics_from_llm,
        mix_meta,
    )

    _progress("export", 94)
    if asset_basename:
        safe_asset = "".join(c for c in asset_basename if c.isalnum() or c in ".-_") or "out.mp3"
        if not safe_asset.lower().endswith(".mp3"):
            safe_asset = f"{safe_asset}.mp3"
        out_path = ASSETS_DIR / safe_asset
        out_path.write_bytes(mixed)
        audio_url = f"/assets/{safe_asset}"
        fname = safe_asset
    else:
        safe = "".join(c for c in morse.abbrev_normalized.lower() if c.isalnum()) or "user"
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        variant = "vocal" if with_vocals else "inst"
        fname = f"m_{safe}_{style.id}_{variant}_{stamp}.mp3"
        out_path = OUTPUT_DIR / fname
        out_path.write_bytes(mixed)
        audio_url = f"/media/{fname}"

    _progress("done", 100)
    return {
        "word": morse.abbrev_normalized,
        "morse_pretty": morse.morse_pretty,
        "style_label": style.label,
        "with_vocals": with_vocals,
        "audio_url": audio_url,
        "intro_duration_ms": intro_ms,
        "letter_timeline": letter_timeline,
        "dot_effect": dot_effect,
        "dash_effect": dash_effect,
        "hook_key": key_desc,
        "hook_bpm": mix_meta.get("detected_bpm", target_bpm),
        "beat_detected": mix_meta.get("beat_detected", False),
    }


if _SPA_FRONTEND is None:
    @app.get("/")
    async def index_page() -> FileResponse:
        """原版「声印」静态页（来源：generate_morse_music/static/index.html）。"""
        index = STATIC_DIR / "index.html"
        if not index.is_file():
            raise HTTPException(
                status_code=500,
                detail="缺少 static/index.html，请从仓库 backend/morse_api/static 部署该文件。",
            )
        return FileResponse(index, media_type="text/html; charset=utf-8")


@app.get("/api/health")
async def api_health() -> dict:
    return {"ok": True, "service": "morse-music-api"}


@app.get("/api/styles")
async def api_styles() -> dict:
    return {"styles": list_styles()}


@app.get("/api/demo")
async def api_demo() -> dict:
    """碟中谍示例（内置时间轴）；不走 AI。需 assets/mission.mp3（正版短片段）。"""
    audio_path = ASSETS_DIR / "mission.mp3"
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="示例音频缺失，请将 mission.mp3 放到 assets/。")
    return _MISSION_DEMO


@app.get("/api/demo-horse")
async def api_demo_horse() -> dict:
    """快乐小马 / HORSE 摩斯示例；需 assets/horse.mp3。生成该文件见 export_horse_demo.py。"""
    audio_path = ASSETS_DIR / "horse.mp3"
    if not audio_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="horse.mp3 缺失。请在 backend 目录执行：python -m morse_api.export_horse_demo（需 MiniMax API Key）。",
        )
    return dict(_HORSE_DEMO)


@app.post("/api/generate")
async def api_generate(body: GenerateBody) -> dict:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    word = (body.word or body.name or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="请填写单词（word）")
    try:
        return _run_generate(word, body.style, with_vocals=bool(body.with_vocals))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except MiniMaxAPIError as e:
        logger.error("MiniMax: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.exception("生成失败")
        raise HTTPException(status_code=500, detail=f"服务器错误：{e}") from e


# ======================= 异步生成任务 =======================
# 生成需数十秒（两次 LLM + 音乐模型 + 混音）；改为后台线程执行 + 前端轮询进度，
# 避免一次 HTTP 长阻塞（最长 300s）导致的超时与「盲等」体验。

_TASKS: dict[str, dict] = {}
_TASKS_LOCK = threading.Lock()
_TASK_TTL_SEC = 1800  # 30 分钟后清理

_STAGE_LABEL = {
    "queued": "排队中",
    "encode": "编码摩斯",
    "hook": "合成记忆动机",
    "prompt": "构思编曲",
    "lyrics": "谱写歌词",
    "ai_music": "AI 生成音乐",
    "align_mix": "节拍对齐 · 混音",
    "export": "导出音频",
    "done": "完成",
    "error": "出错",
}


def _gc_tasks() -> None:
    now = time.time()
    with _TASKS_LOCK:
        stale = [k for k, v in _TASKS.items() if now - v.get("created", now) > _TASK_TTL_SEC]
        for k in stale:
            _TASKS.pop(k, None)


def _set_task(task_id: str, **fields) -> None:
    with _TASKS_LOCK:
        t = _TASKS.get(task_id)
        if t is not None:
            t.update(fields)


def _run_task(task_id: str, word: str, style: Optional[str], with_vocals: bool) -> None:
    def _cb(stage: str, pct: int) -> None:
        _set_task(task_id, stage=stage, stage_label=_STAGE_LABEL.get(stage, stage), progress=pct)

    _set_task(task_id, status="running", stage="encode", stage_label=_STAGE_LABEL["encode"], progress=5)
    try:
        result = _run_generate(word, style, with_vocals=with_vocals, progress_cb=_cb)
        _set_task(task_id, status="done", stage="done", stage_label=_STAGE_LABEL["done"],
                  progress=100, result=result)
    except ValueError as e:
        _set_task(task_id, status="error", stage="error", stage_label=_STAGE_LABEL["error"],
                  error=str(e), http_status=400)
    except MiniMaxAPIError as e:
        logger.error("MiniMax(async): %s", e)
        _set_task(task_id, status="error", stage="error", stage_label=_STAGE_LABEL["error"],
                  error=str(e), http_status=502)
    except Exception as e:  # noqa: BLE001
        logger.exception("异步生成失败")
        _set_task(task_id, status="error", stage="error", stage_label=_STAGE_LABEL["error"],
                  error=f"服务器错误：{e}", http_status=500)


@app.post("/api/generate/start")
async def api_generate_start(body: GenerateBody) -> dict:
    """启动异步生成，立即返回 task_id；前端用 /api/generate/status/{id} 轮询。"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    word = (body.word or body.name or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="请填写单词（word）")
    _gc_tasks()
    task_id = uuid.uuid4().hex[:16]
    with _TASKS_LOCK:
        _TASKS[task_id] = {
            "status": "queued", "stage": "queued", "stage_label": _STAGE_LABEL["queued"],
            "progress": 0, "created": time.time(), "result": None, "error": None,
        }
    th = threading.Thread(
        target=_run_task, args=(task_id, word, body.style, bool(body.with_vocals)), daemon=True
    )
    th.start()
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/generate/status/{task_id}")
async def api_generate_status(task_id: str) -> dict:
    with _TASKS_LOCK:
        t = _TASKS.get(task_id)
        if t is None:
            raise HTTPException(status_code=404, detail="任务不存在或已过期，请重新生成。")
        snapshot = dict(t)
    return {
        "task_id": task_id,
        "status": snapshot["status"],
        "stage": snapshot["stage"],
        "stage_label": snapshot["stage_label"],
        "progress": snapshot["progress"],
        "result": snapshot.get("result"),
        "error": snapshot.get("error"),
    }


# 一体化 React 前端（Vite build）：必须在所有 /api、/media、/assets 路由之后挂载
if _SPA_FRONTEND is not None:
    app.mount("/", StaticFiles(directory=str(_SPA_FRONTEND), html=True), name="spa")
