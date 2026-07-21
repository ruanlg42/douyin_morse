"""
MiniMax music-cover / music-cover-free 客户端。

接口：POST {api_base}/v1/music_generation
认证：Authorization: Bearer <API_key>

响应：output_format=hex 时，data.audio 为十六进制字符串，需解码为二进制 MP3/WAV 等。
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

from .config import DemoConfig

logger = logging.getLogger(__name__)

STATUS_MESSAGES: dict[int, str] = {
    0: "成功",
    1002: "触发限流，请稍后重试（降低频率或稍候再调用）",
    1004: "鉴权失败，请检查 API Key 是否有效",
    1008: "余额不足",
    1026: "内容命中敏感策略",
    2013: "参数非法，请检查 prompt 长度、参考音频格式与大小等",
    2049: "API Key 无效",
}


class MiniMaxAPIError(RuntimeError):
    """MiniMax 业务错误或 HTTP 错误。"""

    def __init__(self, message: str, *, status_code: Optional[int] = None, raw: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.raw = raw


def _explain_status(code: int) -> str:
    return STATUS_MESSAGES.get(code, f"未知状态码 {code}，请参考官方错误码文档")


def _explain_text_status(code: int) -> str:
    text_map = {
        1000: "未知错误",
        1001: "请求超时",
        1002: "触发限流",
        1004: "鉴权失败",
        1008: "余额不足",
        1013: "服务内部错误",
        1027: "输出内容错误",
        1039: "Token 超出限制",
        2013: "参数错误",
    }
    return text_map.get(code, _explain_status(code))


def text_chat_completion_v2(
    cfg: DemoConfig,
    api_key: str,
    *,
    system_prompt: str,
    user_prompt: str,
) -> str:
    """
    POST /v1/text/chatcompletion_v2，模型 M2-her。
    返回 assistant 的 content 文本；失败抛出 MiniMaxAPIError。
    """
    api_key = _normalize_api_key_for_http_header(api_key)
    url = f"{cfg.api_base.rstrip('/')}{cfg.text_chat_endpoint}"
    if not url.isascii():
        raise ValueError("API 地址含非 ASCII 字符。")

    body: dict[str, Any] = {
        "model": cfg.text_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "max_completion_tokens": min(2048, max(64, int(cfg.text_max_completion_tokens))),
        "temperature": 0.85,
        "top_p": 0.95,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    logger.info("POST %s model=%s (text)", url, cfg.text_model)
    try:
        with urllib.request.urlopen(req, timeout=cfg.text_timeout_sec) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        logger.error("Text HTTP %s: %s", e.code, detail[:2000])
        raise MiniMaxAPIError(
            f"文本 API HTTP {e.code}：{detail}",
            status_code=e.code,
            raw=detail,
        ) from e
    except urllib.error.URLError as e:
        raise MiniMaxAPIError(f"文本 API 网络错误：{e}") from e

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        raise MiniMaxAPIError(f"文本 API 响应非 JSON：{text[:500]}", raw=text) from e

    base_resp = result.get("base_resp") or {}
    code = base_resp.get("status_code")
    msg = base_resp.get("status_msg", "")
    if code is not None and int(code) != 0:
        raise MiniMaxAPIError(
            f"文本 API 错误 status_code={code}（{_explain_text_status(int(code))}）status_msg={msg}",
            status_code=int(code),
            raw=result,
        )

    choices = result.get("choices") or []
    if not choices:
        raise MiniMaxAPIError("文本 API 响应无 choices", raw=result)
    message = choices[0].get("message") or {}
    content = (message.get("content") or "").strip()
    if not content:
        raise MiniMaxAPIError("文本 API 返回空内容", raw=result)
    return content


def sanitize_llm_music_prompt(raw: str) -> str:
    """去掉 Markdown/前缀，压成一段，供 music_generation 使用。"""
    s = (raw or "").strip()
    if not s:
        return ""
    s = re.sub(r"^```[a-zA-Z0-9]*\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    for prefix in ("音乐提示词：", "提示词：", "输出：", "正文："):
        if s.startswith(prefix):
            s = s[len(prefix) :].strip()
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _vocalize_fallback_prompt(fb: str) -> str:
    """把「纯器乐」兜底模板里的无人声约束替换成允许主唱人声的表述。"""
    replacements = [
        ("全曲纯器乐，不要任何人声。", "加入一位契合风格的主唱人声，人声自然干净、不过度加工。"),
        ("全曲纯器乐，不要任何人声", "加入契合风格的主唱人声，自然干净"),
        ("纯器乐，不要任何人声。", "含主唱人声。"),
        ("纯器乐，不要任何人声", "含主唱人声"),
        ("纯器乐", "含主唱人声"),
        ("不要任何人声。", "主唱人声清澈自然。"),
        ("不要任何人声", "主唱人声清澈自然"),
    ]
    out = fb
    for a, b in replacements:
        out = out.replace(a, b)
    return out


def generate_instrumental_prompt_for_name(
    cfg: DemoConfig,
    api_key: str,
    *,
    abbrev: str,
    morse_dot_dash: str,
    morse_pretty: str,
    style_label: str = "治愈钢琴",
    style_hint: str = "",
    fallback_prompt: Optional[str] = None,
    with_vocals: bool = False,
    theme_cn: Optional[str] = None,
    target_bpm: Optional[int] = None,
    key_desc: Optional[str] = None,
    hook_kind: str = "melodic",
) -> tuple[str, bool]:
    """
    先由文本模型根据「词语 + 风格」写出完整音乐生成提示词，供 music_generation 使用。

    Args:
        with_vocals: True 时产出「带人声」的编曲指令；False 时产出「纯器乐」指令。
        target_bpm: 目标速度；写入提示词并作为后期节拍对齐的锚点。
        key_desc: 目标调式描述（如「C 大调五声」）；写入提示词，供 hook 定调呼应。
        hook_kind: 摩斯动机的形态，决定 AI 编曲要为它「让」出的空间：
            - "melodic"（旋律，钢琴/铃等）：让出中高音区，让旋律线穿透；
            - "percussive"（节奏，真实架子鼓）：编曲自身鼓组要克制稀疏，
              把强拍与底鼓/军鼓的节奏骨架位置让给摩斯鼓点，低频不要挤占。

    Returns:
        (prompt, used_llm) — 若 LLM 失败则 prompt 为 fallback_prompt 或默认模板。
    """
    if with_vocals:
        system = (
            "你是资深音乐监制与提示词工程师，擅长把「一个词 + 指定风格」转化为可执行的「含主唱人声」编曲指令。"
            "你只根据用户给出的信息做合理联想，不输出与音乐无关的内容。"
        )
        voice_rule = (
            "必须明确写出：包含一位主唱人声（请指定音色——温暖女声或清澈男声，任选其一且要贴合风格），"
            "人声自然干净、不过度加工；可出现适度和声铺垫。"
        )
    else:
        system = (
            "你是资深音乐监制与提示词工程师，擅长把「一个词 + 指定风格」转化为可执行的纯器乐编曲指令。"
            "你只根据用户给出的信息做合理联想，不输出与音乐无关的内容。"
        )
        voice_rule = "必须明确写出：全曲纯器乐，不要任何人声。"

    hint_block = f"\n风格锚点「{style_label}」必须包含这些元素：{style_hint}\n" if style_hint else ""
    theme_block = ""
    if theme_cn:
        theme_block = (
            f"\n本曲在应用界面上的展示标题为「{theme_cn}」。撰写编曲提示词时，必须在正文里至少出现一次「{theme_cn}」四字，"
            f"并自然写出欢快小马、原野轻蹄、阳光草地等意象，与英文词 {abbrev} 的气质相呼应。\n"
        )
    # 节拍/调式锚点：让 AI 成品在固定 BPM 与调式上，便于后期把「摩斯 hook」精确对齐并叠入
    tempo_block = ""
    if target_bpm:
        tempo_block += (
            f"\n【速度锚点】整曲必须稳定在约 {target_bpm} BPM 的 4/4 拍，节拍清晰、不要自由散板或频繁变速，"
            "便于后期把一段固定节奏的动机精确对齐叠入。\n"
        )
    if key_desc:
        tempo_block += (
            f"【调式锚点】整曲主调为{key_desc}，主奏与和声围绕该调式展开，色彩统一。\n"
        )
    # 「让路」段落随摩斯动机的形态切换：旋律动机让中高音区；节奏动机让节奏骨架与低频
    if hook_kind == "percussive":
        tempo_block += (
            "【为节奏动机让路】后期会在本曲上叠入一条真实「架子鼓」演奏的固定节奏动机(hook)，"
            "它承担强拍与骨架律动。因此本曲自身的鼓组/打击乐必须克制、稀疏、留白，"
            "不要写密集连打的底鼓与军鼓；把每小节强拍(第1、3拍)与低频冲击的位置留空，让叠入的鼓点动机成为节奏主心骨；"
            "低频(底鼓/低音)不要过满，给外来鼓点的底鼓留出冲击空间；"
            "主歌织体更疏、副歌也以旋律与和声推进为主，避免与外来鼓点抢节奏。\n"
        )
    else:
        tempo_block += (
            "【为旋律动机让路】后期会叠入一条清晰、反复出现的短「旋律」记忆动机(hook)。"
            "副歌/高潮处中低频不要过满、留出中高音区，让这条旋律能清晰穿透；"
            "主歌段落织体可更疏，动机会以更轻的音量若隐若现地贯穿全曲。\n"
        )
    # 第 3、4 点措辞随动机形态切换：旋律→与旋律叠化；节奏→给外来鼓点留骨架
    if hook_kind == "percussive":
        layer_rule = (
            "开头数小节自身鼓组留白、强拍留空，便于与前奏进入的「摩斯架子鼓节奏动机」严丝合缝地咬合而不打架。"
        )
        constraint_names = "【速度锚点】【调式锚点】【为节奏动机让路】"
    else:
        layer_rule = (
            "开头数小节和声清淡、留白感足，便于与前奏里「摩斯旋律动机」叠化而不嘈杂。"
        )
        constraint_names = "【速度锚点】【调式锚点】【为旋律动机让路】"
    user = (
        f"用户为自己定制的「声音签名」输入了一个专属英文词（可能是名字、昵称或任意英文单词，已规范为大写字母）：{abbrev}\n"
        f"该词对应的摩斯电码（点划，字母间空格）：{morse_dot_dash}\n"
        f"可视化（点· 划−）：{morse_pretty}\n"
        f"用户选择的风格：{style_label}"
        f"{hint_block}"
        f"{theme_block}"
        f"{tempo_block}\n"
        "请根据这个词在中文文化语境中常见的气质、音节听感与情绪联想（不必逐字母解释摩斯），"
        "结合用户选择的风格，决定整首歌曲应有的：主奏与辅奏乐器组合、速度与律动松紧、"
        "情绪弧线（从略带神秘或私密的引子到更舒展的高潮再到余韵）、色彩和声与织体疏密。\n\n"
        "输出要求：\n"
        "1. 只输出一段可直接交给「音乐生成模型」的中文提示词正文；不要标题、不要 Markdown、不要编号列表、不要用引号整段包裹。\n"
        "2. 风格必须严格贴合上方「风格锚点」，不要改变主风格；在其框架内服务于这个词的气质。\n"
        "3. 必须具体写出编曲层次（主奏乐器 + 铺底 + 节奏型），以及情绪如何递进；"
        f"{layer_rule}\n"
        f"4. 必须遵守上方{constraint_names}的约束。\n"
        f"5. {voice_rule}\n"
        "6. 避免空泛套话；篇幅约 280～900 个汉字，最长不要超过 1800 字。"
    )
    try:
        raw = text_chat_completion_v2(cfg, api_key, system_prompt=system, user_prompt=user)
        cleaned = sanitize_llm_music_prompt(raw)
        if len(cleaned) < 80:
            raise ValueError(f"清洗后提示词过短（{len(cleaned)} 字）")
        if len(cleaned) > 2000:
            cleaned = cleaned[:2000]
        logger.info("文本模型音乐提示词（前 120 字）：%s…", cleaned[:120])
        return cleaned, True
    except Exception as e:
        logger.warning("文本模型生成音乐提示词失败，使用默认模板：%s", e)
        fb = fallback_prompt or build_cover_prompt_intro_morse()
        if theme_cn:
            fb = (
                f"以「{theme_cn}」为标题意象，编曲提示词须直接包含「{theme_cn}」四字，"
                f"并体现欢快小马、原野与轻快节奏；{fb}"
            )
        if with_vocals:
            fb = _vocalize_fallback_prompt(fb)
        return fb, False


def generate_lyrics_for_name(
    cfg: DemoConfig,
    api_key: str,
    *,
    abbrev: str,
    style_label: str,
    style_hint: str = "",
    fallback_morse: str = "",
) -> tuple[str, bool]:
    """
    由文本模型根据「词 + 风格」写一段中文流行歌词（带 [Verse]/[Chorus] 段落标签）。

    Returns:
        (lyrics, used_llm) —— LLM 失败回退到 build_lyrics_from_morse 的简单模板。
    """
    system = (
        "你是资深中文流行音乐词作人，擅长为短词或名字写出情感饱满、便于 AI 演唱的中文流行歌词。"
        "你只输出歌词本体，不输出任何解释。"
    )
    hint_block = f"参考风格氛围（仅用于把握情绪，切勿把风格名写进歌词）：{style_hint}\n" if style_hint else ""
    user = (
        f"请为一首歌写一段中文歌词，情绪贴合「{style_label}」的氛围。\n"
        f"核心意象是英文词 {abbrev}：把它当作对方的名字或暗号，在副歌里自然反复出现。\n"
        f"{hint_block}\n"
        "严格输出格式：\n"
        "1. 用段落标签 [Verse]、[Chorus]、[Bridge]，每个标签单独占一行；至少一个 Verse、一个 Chorus。\n"
        "2. 每句歌词单独成行，一行一句，一行不超过 14 个汉字；总行数 12–20 行。\n"
        "3. 具象、有画面感，避免口号式空话；不要把「治愈/钢琴/风格/旋律/音符」等音乐术语直接写进歌词。\n"
        "4. 仅输出纯歌词与段落标签；不要编号、不要标点堆砌、不要引号包裹、不要任何解释。\n"
        f"5. 主体中文，副歌可点缀英文词 {abbrev} 本身。"
    )
    try:
        raw = text_chat_completion_v2(cfg, api_key, system_prompt=system, user_prompt=user)
        cleaned = (raw or "").strip()
        # 去掉整段 Markdown 代码块与首尾引号
        cleaned = re.sub(r"^```[a-zA-Z0-9]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
        if cleaned.startswith(('"', "「", "“")) and cleaned.endswith(('"', "」", "”")):
            cleaned = cleaned[1:-1].strip()
        # 去掉模型爱加的结尾解释/注释行（如「（注：全词12行…）」「注：」「说明：」），避免被当歌词演唱
        lines = []
        for ln in cleaned.splitlines():
            s = ln.strip()
            if re.match(r"^[（(]?\s*(注|说明|备注|Note)\s*[:：]", s):
                break  # 从解释行起截断，后面通常都是元描述
            lines.append(ln)
        cleaned = "\n".join(lines).strip()
        # 去掉行内残留的整行括号说明（独占一行的 （...） ）
        cleaned = "\n".join(
            ln for ln in cleaned.splitlines()
            if not re.match(r"^\s*[（(].*[）)]\s*$", ln.strip()) or "[" in ln
        ).strip()
        if len(cleaned) < 40:
            raise ValueError(f"歌词过短（{len(cleaned)} 字）")
        if len(cleaned) > 3500:
            cleaned = cleaned[:3500]
        logger.info("文本模型歌词（前 80 字）：%s…", cleaned[:80])
        return cleaned, True
    except Exception as e:
        logger.warning("文本模型生成歌词失败，使用默认模板：%s", e)
        return build_lyrics_from_morse(abbrev, fallback_morse), False


def _normalize_api_key_for_http_header(api_key: str) -> str:
    """
    urllib/http.client 要求请求头值为 latin-1；Bearer Token 实际均为 ASCII。
    若 Key 里混入中文、全角标点或不可见 Unicode，会报错：
    'latin-1' codec can't encode characters in position 7-10（多在 Bearer 之后）。
    """
    s = (api_key or "").strip().strip("\ufeff")
    if not s:
        raise ValueError("API Key 为空。")
    if not s.isascii():
        bad_idx = next((i for i, c in enumerate(s) if ord(c) > 127), -1)
        ch = s[bad_idx] if bad_idx >= 0 else "?"
        raise ValueError(
            "API Key 中含有非 ASCII 字符（无法放入 HTTP 请求头）。"
            f"第 {bad_idx + 1} 个字符为 U+{ord(ch):04X}（{ch!r}），请从 MiniMax 控制台重新复制密钥，"
            "勿夹带中文、全角符号或说明文字；若使用 key.json，请确认值为纯英文/数字/标点。"
        )
    return s


def generate_music(
    cfg: DemoConfig,
    api_key: str,
    prompt: str,
    lyrics: Optional[str] = None,
) -> bytes:
    """文生曲（music-3.0）。路线 A：AI 出编曲 f，后续在本地把摩斯 x 叠回成品。

    Args:
        prompt: 音乐风格/情绪/BPM/调式描述（1–2000 字符）。
        lyrics: 提供则生成带人声演唱；为 None 则纯器乐 (is_instrumental=true)。
    Returns:
        音频二进制（mp3）。
    行为：
        - 首连易遇 TLS/Connection reset 抖动，按 cfg.music_retries 重试（探针已验证重试后必成）。
        - output_format=hex → 解码 data.audio；output_format=url → 下载 data.audio 指向的直链。
    """
    if not (1 <= len(prompt) <= 2000):
        raise ValueError(f"music prompt 长度需在 1–2000 字符之间（当前 {len(prompt)}）。")

    api_key = _normalize_api_key_for_http_header(api_key)

    url = f"{cfg.api_base.rstrip('/')}{cfg.music_endpoint}"
    if not url.isascii():
        raise ValueError("API 地址含非 ASCII 字符，请检查 MINIMAX_API_BASE / config.api_base。")

    # music-3.0：文本生成音乐（无歌词=纯器乐）
    body: dict[str, Any] = {
        "model": cfg.music_model,
        "prompt": prompt,
        "output_format": cfg.output_format,
        "audio_setting": {
            "sample_rate": cfg.output_sample_rate,
            "bitrate": cfg.output_bitrate,
            "format": cfg.output_audio_format,
        },
        "is_instrumental": lyrics is None,
    }
    if lyrics:
        if not (1 <= len(lyrics) <= 3500):
            raise ValueError(f"歌词长度需在 1–3500 字符之间（当前 {len(lyrics)}）。")
        body["lyrics"] = lyrics

    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    # 带重试的请求：仅对网络类错误重试，HTTP/业务错误立即抛出
    text = ""
    attempts = max(1, int(cfg.music_retries) + 1)
    for i in range(attempts):
        req = urllib.request.Request(
            url=url,
            data=payload,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        logger.info("POST %s model=%s (第 %d/%d 次)", url, cfg.music_model, i + 1, attempts)
        try:
            with urllib.request.urlopen(req, timeout=cfg.request_timeout_sec) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            logger.error("HTTP %s: %s", e.code, detail[:2000])
            raise MiniMaxAPIError(
                f"HTTP {e.code} 请求失败：{detail}",
                status_code=e.code,
                raw=detail,
            ) from e
        except (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError) as e:
            logger.warning("音乐请求网络抖动（第 %d/%d 次）：%s", i + 1, attempts, e)
            if i < attempts - 1:
                # 指数退避：2s→4s→8s→16s→32s（上限 32s），熬过 MiniMax 首连/短时抖动
                backoff = min(32.0, 2.0 * (2 ** i))
                time.sleep(backoff)
                continue
            raise MiniMaxAPIError(f"网络错误（重试 {attempts} 次仍失败）：{e}") from e

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        raise MiniMaxAPIError(f"响应非 JSON：{text[:500]}", raw=text) from e

    base_resp = result.get("base_resp") or {}
    code = base_resp.get("status_code")
    msg = base_resp.get("status_msg", "")
    trace_id = result.get("trace_id", "")
    if trace_id:
        logger.info("trace_id=%s", trace_id)

    if code != 0:
        raise MiniMaxAPIError(
            f"MiniMax 返回错误 status_code={code}（{_explain_status(int(code))}）status_msg={msg}",
            status_code=int(code) if code is not None else None,
            raw=result,
        )

    data = result.get("data") or {}
    gen_status = data.get("status")
    audio_field = data.get("audio")

    if not audio_field:
        if gen_status == 1:
            raise MiniMaxAPIError(
                "音乐仍在生成中（data.status=1）。当前接口未提供轮询 task_id，请稍后重试同一请求。",
                raw=result,
            )
        raise MiniMaxAPIError("响应中缺少 data.audio。完整响应已记录在日志。", raw=result)

    audio_field = audio_field.strip()

    # output_format=url：data.audio 是可下载直链
    if cfg.output_format == "url" or audio_field.startswith("http"):
        try:
            with urllib.request.urlopen(audio_field, timeout=cfg.request_timeout_sec) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            raise MiniMaxAPIError(f"下载 data.audio(url) 失败：{e}", raw=result) from e

    # output_format=hex：解码十六进制
    try:
        return binascii.unhexlify(audio_field)
    except binascii.Error as e:
        raise MiniMaxAPIError(f"data.audio 不是合法十六进制：{e}", raw=result) from e


# 向后兼容旧调用名（内部已改为 music-3.0 文生曲，audio_base64 参数被忽略）
def music_cover_from_base64(
    cfg: DemoConfig,
    api_key: str,
    audio_base64: str,  # noqa: ARG001 兼容旧签名，文生曲不再需要参考音频
    prompt: str,
    lyrics: Optional[str] = None,
) -> bytes:
    return generate_music(cfg, api_key, prompt, lyrics=lyrics)


def build_cover_prompt() -> str:
    """纯音乐版本 prompt。"""
    return (
        "严格保留参考音频里的鼓点节奏、速度与结构，不要改变节拍与鼓的位置；"
        "在此基础上生成温柔治愈的流行钢琴纯音乐，加入轻微弦乐铺底，整体简约干净、有专属感；"
        "纯器乐，不要任何人声。"
    )


def build_cover_prompt_intro_morse() -> str:
    """
    手机端「前奏摩斯 + 全曲器乐」：参考音频不含在请求体时，用文案引导适合与打击乐前奏叠化的编曲。
    """
    return (
        "创作一首温柔治愈的流行钢琴纯音乐，轻微弦乐铺底，情绪从安静、略带神秘感的前奏"
        "自然过渡到温暖明亮的主段；开头数小节留白感稍多、和声清淡，便于与清脆的打击乐节奏层叠而不杂乱；"
        "主段旋律清晰、有记忆点，整体简约干净、适合一人安静聆听与分享。"
        "全曲纯器乐，不要任何人声。"
    )


def build_vocal_prompt() -> str:
    """带人声版本 prompt。"""
    return (
        "温柔治愈的流行民谣风格，温暖治愈的钢琴伴奏，轻微弦乐铺底，"
        "清新自然的女声演唱，整体简约干净、有专属感，适合夜晚聆听。"
    )


def build_lyrics_from_morse(abbrev: str, morse_code: str) -> str:
    """根据缩写和摩斯电码生成简单的歌词。"""
    dots = morse_code.count(".")
    dashes = morse_code.count("-")
    
    lyrics = f"""[Verse]
字母轻声诉说
{abbrev} 是你的名字
每一个符号都是心跳
短促如泪 绵长如思

[Chorus]
滴滴答答 是我想你的声音
{dots}个轻吻 {dashes}次深呼吸
在这个世界的某个角落
摩斯电码 替我拥抱你

[Outro]
滴答 滴答
爱永不停止"""
    return lyrics
