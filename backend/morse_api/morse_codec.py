"""
摩斯电码模块：将用户缩写（仅字母，最多 10 个）转为「字母间用空格分隔」的摩斯串。

展示格式：控制台同时打印「点划串」（. -）与「可视化串」（· −），便于对照题目示例。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# 仅 A–Z（缩写场景）；若需数字可再扩展
MORSE_MAP: dict[str, str] = {
    "A": ".-",
    "B": "-...",
    "C": "-.-.",
    "D": "-..",
    "E": ".",
    "F": "..-.",
    "G": "--.",
    "H": "....",
    "I": "..",
    "J": ".---",
    "K": "-.-",
    "L": ".-..",
    "M": "--",
    "N": "-.",
    "O": "---",
    "P": ".--.",
    "Q": "--.-",
    "R": ".-.",
    "S": "...",
    "T": "-",
    "U": "..-",
    "V": "...-",
    "W": ".--",
    "X": "-..-",
    "Y": "-.--",
    "Z": "--..",
}


@dataclass(frozen=True)
class MorseResult:
    """缩写规范化结果与摩斯编码。"""

    abbrev_normalized: str
    morse_dot_dash: str
    morse_pretty: str


def validate_abbrev(raw: str, max_letters: int = 10) -> str:
    s = raw.strip().upper()
    if not s:
        raise ValueError("缩写不能为空。")
    if not re.fullmatch(r"[A-Z]+", s):
        raise ValueError("缩写仅支持英文字母（A–Z），请勿包含空格、数字或符号。")
    if len(s) > max_letters:
        raise ValueError(f"缩写长度不能超过 {max_letters} 个字母（当前 {len(s)}）。")
    return s


def abbrev_to_morse(abbrev: str) -> MorseResult:
    """
    将连续字母缩写转为摩斯：
    - 字母之间：用一个空格表示休止（与题目一致）
    - 字母内部：由标准点划组成，解析时由鼓模块负责「符间停顿」
    """
    norm = validate_abbrev(abbrev)
    letters: list[str] = []
    pretty_letters: list[str] = []
    for ch in norm:
        code = MORSE_MAP[ch]
        letters.append(code)
        pretty_letters.append(code.replace(".", "·").replace("-", "−"))
    dot_dash = " ".join(letters)
    pretty = " ".join(pretty_letters)
    return MorseResult(
        abbrev_normalized=norm,
        morse_dot_dash=dot_dash,
        morse_pretty=pretty,
    )
