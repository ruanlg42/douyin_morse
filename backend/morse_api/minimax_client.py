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
) -> tuple[str, bool]:
    """
    先由文本模型根据「词语 + 风格」写出完整音乐生成提示词，供 music_generation 使用。

    Args:
        with_vocals: True 时产出「带人声」的编曲指令；False 时产出「纯器乐」指令。

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
    user = (
        f"用户为自己定制的「声音签名」输入了一个专属英文词（可能是名字、昵称或任意英文单词，已规范为大写字母）：{abbrev}\n"
        f"该词对应的摩斯电码（点划，字母间空格）：{morse_dot_dash}\n"
        f"可视化（点· 划−）：{morse_pretty}\n"
        f"用户选择的风格：{style_label}"
        f"{hint_block}"
        f"{theme_block}\n"
        "请根据这个词在中文文化语境中常见的气质、音节听感与情绪联想（不必逐字母解释摩斯），"
        "结合用户选择的风格，决定整首歌曲应有的：主奏与辅奏乐器组合、速度与律动松紧、"
        "情绪弧线（从略带神秘或私密的引子到更舒展的高潮再到余韵）、色彩和声与织体疏密。\n\n"
        "输出要求：\n"
        "1. 只输出一段可直接交给「音乐生成模型」的中文提示词正文；不要标题、不要 Markdown、不要编号列表、不要用引号整段包裹。\n"
        "2. 风格必须严格贴合上方「风格锚点」，不要改变主风格；在其框架内服务于这个词的气质。\n"
        "3. 必须具体写出编曲层次（主奏乐器 + 铺底 + 节奏型），以及情绪如何递进；"
        "开头数小节和声清淡、留白感足，便于与前奏里「摩斯节奏型打击乐」叠化而不嘈杂。\n"
        f"4. {voice_rule}\n"
        "5. 避免空泛套话；篇幅约 280～900 个汉字，最长不要超过 1800 字。"
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
    hint_block = f"风格关键词：{style_hint}\n" if style_hint else ""
    user = (
        f"为一首「{style_label}」风格的歌曲写一段中文歌词。\n"
        f"核心意象是用户的专属英文词：{abbrev}（可以作为对方的名字、暗号或信物反复出现，也可轻轻嵌入行末）。\n"
        f"{hint_block}\n"
        "输出格式要求：\n"
        "1. 使用 [Intro]、[Verse]、[Chorus]、[Bridge]、[Outro] 小节标签，至少包含一个 Verse 和一个 Chorus；段落标签单独成行。\n"
        "2. 每行歌词不超过 18 个汉字；整体字数控制在 280–800 字之间。\n"
        "3. 仅输出纯歌词文本；不要 Markdown、不要编号、不要引号包裹、不要解释。\n"
        "4. 主体中文，可少量英文单词点缀（例如 {abbrev} 本身）。\n"
        "5. 情绪与指定风格契合；避免政治、敏感、低俗或露骨表达。\n"
        "6. 不要出现「人声」「伴奏」「编曲」等元描述。"
    )
    try:
        raw = text_chat_completion_v2(cfg, api_key, system_prompt=system, user_prompt=user)
        cleaned = (raw or "").strip()
        # 去掉整段 Markdown 代码块与首尾引号
        cleaned = re.sub(r"^```[a-zA-Z0-9]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
        if cleaned.startswith(('"', "「", "“")) and cleaned.endswith(('"', "」", "”")):
            cleaned = cleaned[1:-1].strip()
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


def music_cover_from_reference_file(
    cfg: DemoConfig,
    api_key: str,
    reference_audio_path: Path,
    prompt: str,
) -> bytes:
    """读取本地参考音频 → base64 → 调用 music-cover，返回生成音频二进制。"""
    ref_bytes = reference_audio_path.read_bytes()
    b64 = base64.b64encode(ref_bytes).decode("ascii")
    return music_cover_from_base64(cfg, api_key, b64, prompt)


def music_cover_from_base64(
    cfg: DemoConfig,
    api_key: str,
    audio_base64: str,
    prompt: str,
    lyrics: Optional[str] = None,
) -> bytes:
    """生成音乐（music-2.6-free 模型）。
    
    Args:
        lyrics: 如果提供，则生成带人声的歌曲；如果为 None，则生成纯音乐。
    """
    if not (1 <= len(prompt) <= 2000):
        raise ValueError(f"music-2.6-free 的 prompt 长度需在 1–2000 字符之间（当前 {len(prompt)}）。")

    api_key = _normalize_api_key_for_http_header(api_key)

    url = f"{cfg.api_base.rstrip('/')}{cfg.music_endpoint}"
    if not url.isascii():
        raise ValueError("API 地址含非 ASCII 字符，请检查 MINIMAX_API_BASE / config.api_base。")
    
    # music-2.6-free: 文本生成音乐
    body: dict[str, Any] = {
        "model": cfg.cover_model,
        "prompt": prompt,
        "output_format": cfg.output_format,
        "audio_setting": {
            "sample_rate": cfg.output_sample_rate,
            "bitrate": cfg.output_bitrate,
            "format": cfg.output_audio_format,
        },
        "is_instrumental": lyrics is None,  # 无歌词时生成纯音乐
    }
    
    # 如果提供歌词，添加到请求
    if lyrics:
        if not (1 <= len(lyrics) <= 3500):
            raise ValueError(f"歌词长度需在 1–3500 字符之间（当前 {len(lyrics)}）。")
        body["lyrics"] = lyrics

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

    logger.info("POST %s model=%s", url, cfg.cover_model)
    try:
        with urllib.request.urlopen(req, timeout=cfg.request_timeout_sec) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        logger.error("HTTP %s: %s", e.code, detail[:2000])
        raise MiniMaxAPIError(
            f"HTTP {e.code} 请求失败：{detail}",
            status_code=e.code,
            raw=detail,
        ) from e
    except urllib.error.URLError as e:
        raise MiniMaxAPIError(f"网络错误：{e}") from e

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
    audio_hex = data.get("audio")

    if gen_status == 1 and not audio_hex:
        raise MiniMaxAPIError(
            "音乐仍在生成中（data.status=1）。当前接口未提供轮询 task_id，请稍后重试同一请求或联系官方文档。",
            raw=result,
        )

    if not audio_hex:
        raise MiniMaxAPIError(
            "响应中缺少 data.audio（hex）。完整响应已记录在日志。",
            raw=result,
        )

    try:
        return binascii.unhexlify(audio_hex.strip())
    except binascii.Error as e:
        raise MiniMaxAPIError(f"data.audio 不是合法十六进制：{e}", raw=result) from e


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
