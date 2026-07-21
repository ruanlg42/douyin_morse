"""music-3.0 单独探针：确认权限 + url/hex 返回字段结构（带重试绕开网络抖动）。"""
from __future__ import annotations
import json, sys, time, urllib.error, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from morse_api.config import load_config
from morse_api.key_loader import load_bearer_token


def post(url, body, key, timeout, retries=4):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last = (-1, "")
    for i in range(retries + 1):
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {key}",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = (-1, f"{type(e).__name__}: {e}")
            print(f"  · 第 {i+1} 次失败：{last[1]}，2s 后重试…")
            time.sleep(2)
    return last


def show(label, status, text):
    print(f"\n===== [{label}] HTTP={status} =====")
    try:
        obj = json.loads(text)
    except Exception:
        print("非 JSON：", text[:600]); return None
    br = obj.get("base_resp") or {}
    print("status_code =", br.get("status_code"), "| msg =", br.get("status_msg"), "| trace =", obj.get("trace_id"))
    data = obj.get("data") or {}
    if isinstance(data, dict):
        print("data.keys =", list(data.keys()))
        for k, v in data.items():
            sv = f"<{len(v)} chars> {v[:60]}..." if isinstance(v, str) and len(v) > 80 else v
            print(f"  data.{k} = {sv}")
    return obj


def main():
    cfg = load_config()
    key = load_bearer_token(cfg.key_file)
    url = f"{cfg.api_base.rstrip('/')}{cfg.music_endpoint}"
    aset = {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"}
    print("url =", url, "| key 前缀 =", key[:6], "len =", len(key))

    # 变体 1：music-3.0 纯器乐，output_format=url
    show("m3_inst_url", *post(url, {
        "model": "music-3.0",
        "prompt": "healing ambient piano, soft warm pads, gentle, 96 BPM, A minor pentatonic, clear singable main melody, no drums",
        "audio_setting": aset, "output_format": "url", "is_instrumental": True,
    }, key, cfg.request_timeout_sec))

    # 变体 2：music-3.0 纯器乐，output_format=hex（对比返回结构）
    show("m3_inst_hex", *post(url, {
        "model": "music-3.0",
        "prompt": "lofi chill piano, mellow, 90 BPM, clear main melody, instrumental",
        "audio_setting": aset, "output_format": "hex", "is_instrumental": True,
    }, key, cfg.request_timeout_sec))


if __name__ == "__main__":
    main()
