"""
从 key.json 或纯文本读取 MiniMax Bearer Token。

获取路径（与官方一致）：MiniMax 开放平台 → 用户中心 → 接口密钥（API Keys）
https://platform.minimax.io/user-center/basic-information/interface-key
"""
from __future__ import annotations

import json
from pathlib import Path


def load_bearer_token(key_path: Path) -> str:
    raw = key_path.read_text(encoding="utf-8")
    raw = raw.lstrip("\ufeff").strip()
    if not raw:
        raise ValueError("密钥文件为空：请填入 MiniMax API Key。")

    if raw.startswith("{"):
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("key.json 应为 JSON 对象。")
        token = ""
        if data.get("bearer_token"):
            token = str(data["bearer_token"]).strip()
        elif data.get("Authorization"):
            token = str(data["Authorization"]).strip()
            if token.lower().startswith("bearer "):
                token = token[7:].strip()
        else:
            for field in ("api_key", "key", "minimax_api_key", "MINIMAX_API_KEY"):
                if data.get(field):
                    token = str(data[field]).strip()
                    break
        if not token:
            raise ValueError(
                "JSON 格式 key.json 需要 api_key / key / minimax_api_key，"
                "或 bearer_token / Authorization 字段。"
            )
        gid = data.get("group_id")
        if gid and data.get("group_id_with_api_key") is True:
            token = f"{str(gid).strip()}.{token}"
        return token

    for line in raw.splitlines():
        token = line.strip()
        if not token:
            continue
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        return token

    raise ValueError("未能从密钥文件解析出 API Key（每行一个密钥或单行文本）。")
