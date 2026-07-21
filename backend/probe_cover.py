"""
MiniMax cover / music-3.0 接口探针（独立脚本，不改主代码）。

目的：用真实 key 实打接口，坐实以下未知，供后续管线改造参考：
  1) cover 是否支持 audio_base64（本地无公网 URL）还是只认 audio_url
  2) cover 能否走 is_instrumental / 纯器乐（摩斯无歌词，须避免 ASR 塞人声）
  3) key 是否有 music-cover / music-3.0 权限
  4) output_format=url 与 hex 的返回结构差异

用法：
  /opt/miniconda3/bin/python backend/probe_cover.py
产物：
  backend/morse_api/outputs/probe_x.mp3           摩斯参考音频 x（≥6s）
  backend/morse_api/outputs/probe_<label>.mp3     各变体成功时保存的成品
  控制台打印每个变体的 HTTP/status_code/字段结构
"""
from __future__ import annotations

import base64
import binascii
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# 让脚本能 import morse_api 包
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 与后端一致：系统无 ffmpeg 时用 pip 的 static_ffmpeg 注册二进制到 PATH
try:
    import shutil
    if shutil.which("ffmpeg") is None:
        import static_ffmpeg
        static_ffmpeg.add_paths()
except Exception as _e:  # noqa: BLE001
    print("static_ffmpeg 注册失败（若系统已装 ffmpeg 可忽略）：", _e)

from morse_api.config import load_config
from morse_api.key_loader import load_bearer_token
from morse_api.morse_codec import abbrev_to_morse
from morse_api.drum_synth import (
    render_morse_hook_with_timeline,
    normalize_peak,
    floats_to_wav_bytes_mono,
    save_mp3_from_wav_bytes,
)
import numpy as np

OUT_DIR = Path(__file__).resolve().parent / "morse_api" / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def build_reference_x(word: str, cfg, min_sec: float = 6.5) -> np.ndarray:
    """合成带音高的摩斯动机，并循环 + 尾部留白铺满到 >= min_sec（满足 cover 6s 下限）。"""
    morse = abbrev_to_morse(word)
    hook_wave, _notes, _ms = render_morse_hook_with_timeline(
        morse.morse_dot_dash, cfg, root="A", scale="minor_pent", octave=4, timbre="pluck", bpm=96,
    )
    sr = cfg.sample_rate
    one = np.asarray(hook_wave, dtype=np.float32)
    if len(one) == 0:
        raise SystemExit("hook 合成为空")
    # 单遍 + 半拍留白，循环直到 >= min_sec
    gap = np.zeros(int(sr * 0.4), dtype=np.float32)
    unit = np.concatenate([one, gap])
    need = int(sr * min_sec)
    reps = max(1, int(np.ceil(need / len(unit))))
    x = np.tile(unit, reps)[: max(need, len(unit))]
    return normalize_peak(x, headroom_db=1.0)


def post_json(url: str, body: dict, api_key: str, timeout: int, retries: int = 2):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last = (-1, "")
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url=url,
            data=payload,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError) as e:
            last = (-1, f"{type(e).__name__}: {e}")
            print(f"  · 第 {attempt+1} 次请求失败：{last[1]}，重试中…")
    return last


def summarize(label: str, status: int, text: str):
    print(f"\n===== [{label}] HTTP={status} =====")
    try:
        obj = json.loads(text)
    except Exception:
        print("非 JSON 响应（前 800 字）：", text[:800])
        return None
    base = obj.get("base_resp") or {}
    print("base_resp.status_code =", base.get("status_code"), "| status_msg =", base.get("status_msg"))
    print("trace_id =", obj.get("trace_id"))
    data = obj.get("data") or {}
    if isinstance(data, dict):
        keys = list(data.keys())
        print("data.keys =", keys)
        for k in ("status", "audio", "audio_url", "url"):
            if k in data:
                v = data[k]
                if isinstance(v, str) and len(v) > 80:
                    print(f"  data.{k} = <{len(v)} chars> {v[:60]}...")
                else:
                    print(f"  data.{k} = {v}")
    # 顶层可能也有 audio_url
    for k in ("audio_url", "url"):
        if k in obj:
            print(f"top.{k} =", str(obj[k])[:120])
    return obj


def try_save_audio(label: str, obj: dict, cfg):
    """尝试把返回的音频落盘：优先 hex(data.audio)，其次 url。"""
    if not isinstance(obj, dict):
        return
    data = obj.get("data") or {}
    audio_hex = data.get("audio") if isinstance(data, dict) else None
    if audio_hex and isinstance(audio_hex, str):
        try:
            raw = binascii.unhexlify(audio_hex.strip())
            p = OUT_DIR / f"probe_{label}.mp3"
            p.write_bytes(raw)
            print(f"  ✅ 已保存(hex) -> {p}  ({len(raw)} bytes)")
            return
        except binascii.Error as e:
            print("  hex 解码失败：", e)
    # url 情况
    url = None
    if isinstance(data, dict):
        url = data.get("audio_url") or data.get("url")
    url = url or obj.get("audio_url") or obj.get("url")
    if url:
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                raw = r.read()
            p = OUT_DIR / f"probe_{label}.mp3"
            p.write_bytes(raw)
            print(f"  ✅ 已保存(url) -> {p}  ({len(raw)} bytes)  src={url[:80]}")
        except Exception as e:
            print("  url 下载失败：", e)


def main():
    cfg = load_config()
    api_key = load_bearer_token(cfg.key_file)
    print("api_base =", cfg.api_base, "| endpoint =", cfg.music_endpoint)
    print("key 前缀 =", api_key[:6], "... 长度 =", len(api_key))
    url = f"{cfg.api_base.rstrip('/')}{cfg.music_endpoint}"

    # --- 合成摩斯参考音频 x（>=6s），并存 mp3 + base64 ---
    x = build_reference_x("SOS", cfg, min_sec=6.5)
    wav_bytes = floats_to_wav_bytes_mono(x, cfg.sample_rate)
    x_mp3 = OUT_DIR / "probe_x.mp3"
    save_mp3_from_wav_bytes(wav_bytes, x_mp3, bitrate=cfg.output_bitrate)
    x_bytes = x_mp3.read_bytes()
    x_b64 = base64.b64encode(x_bytes).decode("ascii")
    print(f"\n摩斯参考音频 x: 时长≈{len(x)/cfg.sample_rate:.1f}s  mp3={len(x_bytes)} bytes  b64={len(x_b64)} chars -> {x_mp3}")

    audio_setting = {
        "sample_rate": cfg.output_sample_rate,
        "bitrate": cfg.output_bitrate,
        "format": cfg.output_audio_format,
    }

    # ============ 变体清单 ============
    # A. baseline：music-3.0 纯器乐文生曲（确认新模型 + 权限）
    variants = []
    variants.append(("music3_instrumental", {
        "model": "music-3.0",
        "prompt": "healing ambient piano, soft pads, gentle, 96 BPM, A minor pentatonic, clear main melody",
        "audio_setting": audio_setting,
        "output_format": "url",
        "is_instrumental": True,
    }))

    # B. cover + audio_base64 + 纯器乐（我们的目标主路径）
    variants.append(("cover_b64_instrumental", {
        "model": "music-cover",
        "audio_base64": x_b64,
        "prompt": "healing ambient piano cover, keep the melody, soft, 96 BPM",
        "audio_setting": audio_setting,
        "output_format": "url",
        "is_instrumental": True,
    }))

    # C. cover + audio_base64（不带 instrumental，看是否强制 ASR 人声/报错）
    variants.append(("cover_b64_default", {
        "model": "music-cover",
        "audio_base64": x_b64,
        "prompt": "lofi piano cover, keep the melody",
        "audio_setting": audio_setting,
        "output_format": "url",
    }))

    for label, body in variants:
        try:
            status, text = post_json(url, body, api_key, cfg.request_timeout_sec)
            obj = summarize(label, status, text)
            if obj:
                try_save_audio(label, obj, cfg)
        except Exception as e:  # noqa: BLE001
            print(f"\n===== [{label}] 变体异常：{type(e).__name__}: {e} =====")

    print("\n探针结束。请把上面每个变体的 status_code / data.keys / 是否保存成功贴给我。")


if __name__ == "__main__":
    main()
