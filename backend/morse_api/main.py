"""
FastAPI 服务（与历史包 generate_morse_music.app_mobile 对齐）：

- GET / → static/index.html（原版「声印」单页试玩，同 generate_morse_music/static）
- /api/*、/media、/assets 与一体化前端（frontend/）共用

完整三 Tab 应用请用根目录 start.py；仅想试声印时可只起后端并打开 http://127.0.0.1:8765/
"""
from __future__ import annotations

import logging
import os
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
from .drum_synth import effect_for_voice, render_intro_drums_with_timeline
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
    buf = BytesIO()
    out.export(buf, format="mp3", bitrate="256k")
    return buf.getvalue()


def _run_generate(
    word: str,
    style_id: Optional[str],
    with_vocals: bool = False,
    *,
    theme_cn: Optional[str] = None,
    asset_basename: Optional[str] = None,
) -> dict:
    cfg = load_config()
    style = resolve_style(style_id)
    if style.bpm_hint:
        cfg = replace(cfg, bpm=int(style.bpm_hint))

    morse = abbrev_to_morse(word.strip())

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

    api_key = _resolve_api_key()
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
    )

    lyrics: Optional[str] = None
    lyrics_from_llm = False
    if with_vocals:
        lyrics, lyrics_from_llm = generate_lyrics_for_name(
            cfg,
            api_key,
            abbrev=morse.abbrev_normalized,
            style_label=style.label,
            style_hint=style.music_hint,
            fallback_morse=morse.morse_dot_dash,
        )

    music_bytes = music_cover_from_base64(cfg, api_key, "", music_prompt, lyrics=lyrics)
    mixed = _mix_intro_drums_with_music(intro_wav, music_bytes, drum_overlay_db=style.drum_overlay_db)

    logger.info(
        "music_prompt_from_llm=%s  with_vocals=%s  lyrics_from_llm=%s",
        prompt_from_llm,
        with_vocals,
        lyrics_from_llm,
    )

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


# 一体化 React 前端（Vite build）：必须在所有 /api、/media、/assets 路由之后挂载
if _SPA_FRONTEND is not None:
    app.mount("/", StaticFiles(directory=str(_SPA_FRONTEND), html=True), name="spa")
