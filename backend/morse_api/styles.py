"""
风格档位定义：UI 侧的风格选择 → 鼓音色 + 音乐提示词关键词 + 回退提示词。

键字段：
- id / label：前端展示与存取。
- drum_voices: (short_voice_id, long_voice_id) —— 对应 `drum_synth.VOICE_REGISTRY`。
- music_hint: 文本模型生成音乐提示词时的「必须包含的风格关键词」。
- fallback_prompt: 文本模型失败时直接走的默认提示词。
- drum_overlay_db: 混音时鼓轨相对 AI 音乐的相对音量（负数为压低）。
- bpm_hint: 可选；若提供则覆盖 DemoConfig.bpm（某些风格更合适稍快或稍慢）。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class StyleSpec:
    id: str
    label: str
    drum_voices: tuple[str, str]  # (short, long)
    music_hint: str
    fallback_prompt: str
    drum_overlay_db: float = -10.0
    bpm_hint: Optional[int] = None
    # hook 动机的调式/音色：root 音名、scale（见 drum_synth.SCALES）、timbre、八度
    key_root: str = "A"
    key_scale: str = "minor_pent"
    hook_timbre: str = "pluck"
    hook_octave: int = 4
    # 摩斯动机形态：
    #   "melodic"    —— 用真实旋律乐器(钢琴/铃/拨弦)演奏音高化 hook；AI 编曲让出中高音区。
    #   "percussive" —— 用真实架子鼓(GM 鼓组)把点划打成鼓点；AI 编曲鼓组克制、让出节奏骨架与低频。
    hook_kind: str = "melodic"
    # 架子鼓套件（仅 hook_kind="percussive" 时生效）：standard / groove / brushed
    drum_kit: str = "standard"
    drum_preset: int = 0


STYLES: dict[str, StyleSpec] = {
    "healing": StyleSpec(
        id="healing",
        label="治愈钢琴",
        drum_voices=("marimba_short", "bass_pluck_long"),
        music_hint=(
            "温柔治愈的流行钢琴主奏，加入轻微弦乐铺底与远处的木质打击感，"
            "节奏松弛、留白感足；开头 4–8 小节和声清淡，便于与清脆木琴类节奏点叠化不嘈杂；"
            "主段旋律线条温暖明亮、有记忆点；整体简约干净、适合一人安静聆听。"
        ),
        fallback_prompt=(
            "创作一首温柔治愈的流行钢琴纯音乐，主奏钢琴，副手轻微弦乐铺底与极轻木质打击，"
            "前奏数小节留白感足、和声清淡，便于与清脆打击乐叠化；随后主段旋律清晰、温暖明亮、"
            "情绪渐进自然，整体简约干净、有专属感。全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-14.0,
        key_root="C", key_scale="major_pent", hook_timbre="piano", hook_octave=5,
    ),
    "cinematic": StyleSpec(
        id="cinematic",
        label="电影叙事",
        drum_voices=("taiko_short", "timpani_long"),
        music_hint=(
            "史诗电影配乐质感，大编制弦乐群铺底，钢琴或竖琴点缀，辅以远处的定音鼓与堂鼓低频冲击；"
            "空间感强、混响丰富；前奏神秘克制、随后情绪逐步推高至宽广的主段；避免过度激烈的打击节奏，"
            "保留旋律主导。"
        ),
        fallback_prompt=(
            "一首电影感十足的史诗纯器乐：弦乐群作为主体铺底，钢琴与竖琴担任主奏与点缀，"
            "低频定音鼓与堂鼓稀疏、有仪式感；前奏克制神秘，中段情绪推高、空间感宏大；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-12.0,
        key_root="D", key_scale="minor", hook_timbre="tubular-bells", hook_octave=5,
    ),
    "lofi": StyleSpec(
        id="lofi",
        label="慵懒 Lo-Fi",
        drum_voices=("clap_short", "tape_kick_long"),
        music_hint=(
            "Lo-Fi Hip Hop 氛围，低饱和钢琴或电钢主奏，磁带底噪与轻柔黑胶摩擦声；"
            "有慵懒的 swing 律动，贝斯圆润克制；打击乐以 soft clap + 闷底鼓为主；"
            "整体温暖、私密、适合夜晚学习或独处。"
        ),
        fallback_prompt=(
            "一首慵懒的 Lo-Fi Hip Hop 纯器乐：低饱和电钢与圆润贝斯，磁带底噪与黑胶摩擦感，"
            "轻微 swing 律动，soft clap 与闷底鼓稀疏有致；前奏留白自然，适合与节奏点叠化；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-13.0,
        bpm_hint=86,
        key_root="F", key_scale="major_pent", hook_timbre="epiano", hook_octave=4,
    ),
    "retro8bit": StyleSpec(
        id="retro8bit",
        label="8-bit 像素",
        drum_voices=("square_short", "square_long"),
        music_hint=(
            "复古 8-bit 像素游戏音乐，chiptune 方波主旋律，三角波贝斯，噪声通道作为打击；"
            "律动明快、活泼、带冒险感；前奏用短促方波点击营造信号感，随后进入欢快主段。"
        ),
        fallback_prompt=(
            "一首复古 8-bit chiptune 纯器乐：方波主旋律轻快活泼，三角波贝斯稳定推进，"
            "噪声通道做打击；前奏短促方波点击营造信号感；整体带冒险与像素游戏怀旧气质；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-16.0,
        bpm_hint=128,
        key_root="E", key_scale="major_pent", hook_timbre="music-box", hook_octave=5,
    ),
    "synthwave": StyleSpec(
        id="synthwave",
        label="合成怀旧",
        drum_voices=("hihat_short", "sub_kick_long"),
        music_hint=(
            "80 年代 synthwave/outrun 怀旧合成风：模拟合成 lead、宽阔 pad、复古 FM 电钢，"
            "带轻微合唱效果与长混响；节奏稳健 4/4，律动有夜晚驾驶般的动感；前奏神秘悠长。"
        ),
        fallback_prompt=(
            "一首 80s synthwave outrun 纯器乐：模拟合成 lead 主奏，宽阔合成 pad 铺底，"
            "FM 电钢点缀，带合唱与长混响；稳健 4/4 律动，带夜晚驾驶感；前奏神秘悠长；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-14.0,
        bpm_hint=104,
        hook_kind="percussive", drum_kit="groove", drum_preset=0,
    ),
    "jazz_cafe": StyleSpec(
        id="jazz_cafe",
        label="爵士咖啡",
        drum_voices=("brush_short", "bass_pluck_long"),
        music_hint=(
            "温润慵懒的咖啡馆爵士三重奏：钢琴主奏带 7/9 和弦色彩，轻度 swing，"
            "立式贝斯走动，鼓刷扫击与 ride 点缀；整体精致、低饱和、午后阳光感。"
        ),
        fallback_prompt=(
            "一首咖啡馆爵士三重奏纯器乐：钢琴主奏带 7/9 和弦色彩，轻度 swing 律动，"
            "立式贝斯走动推进，鼓刷与 ride 轻点；低饱和、温润精致；全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-13.0,
        bpm_hint=96,
        key_root="A", key_scale="major_pent", hook_timbre="vibraphone", hook_octave=4,
    ),
    "folk_acoustic": StyleSpec(
        id="folk_acoustic",
        label="民谣原声",
        drum_voices=("rim_short", "bass_pluck_long"),
        music_hint=(
            "清新温暖的原声民谣：指弹原声吉他为主奏，辅以轻柔口琴或小号点缀、原声贝斯垫底，"
            "木质节奏点偶尔轻拍；整体真诚亲切、像窗边清晨。"
        ),
        fallback_prompt=(
            "一首温暖的原声民谣纯器乐：指弹原声吉他主奏，温和口琴或木质乐器点缀，"
            "原声贝斯稳定铺底，木质节奏点轻巧；真诚亲切；全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-14.0,
        bpm_hint=100,
        key_root="G", key_scale="major_pent", hook_timbre="guitar", hook_octave=4,
    ),
    "ambient": StyleSpec(
        id="ambient",
        label="氛围冥想",
        drum_voices=("rim_short", "timpani_long"),
        music_hint=(
            "宽阔的氛围/后摇氛围：缓慢 pad、轻扫弦乐群、玻璃质感铃铛点缀，"
            "节奏极其稀疏，几乎无鼓；长混响与空间感，适合冥想、睡前、专注。"
        ),
        fallback_prompt=(
            "一首安静冥想的氛围纯器乐：缓慢合成 pad + 轻扫弦乐群，玻璃铃铛点缀，"
            "节奏极稀疏，几乎无鼓；长混响带宽阔空间感；全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-18.0,
        bpm_hint=72,
        key_root="C", key_scale="major_pent", hook_timbre="celeste", hook_octave=5,
    ),
    "edm": StyleSpec(
        id="edm",
        label="电子律动",
        drum_voices=("hihat_short", "sub_kick_long"),
        music_hint=(
            "现代电子舞曲律动：清脆 hi-hat、浑厚 sub kick，合成 lead 有记忆点，"
            "侧链压缩明显；前奏铺陈后进入推拉段落，律动动感向上。"
        ),
        fallback_prompt=(
            "一首现代电子舞曲纯器乐：清脆 hi-hat 与浑厚 sub kick 稳定推进，"
            "合成 lead 主旋律有钩子，侧链压缩明显；前奏铺陈、主段律动向上；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-15.0,
        bpm_hint=122,
        hook_kind="percussive", drum_kit="groove", drum_preset=0,
    ),
    "funk": StyleSpec(
        id="funk",
        label="放克律动",
        drum_voices=("hihat_short", "slap_bass_long"),
        music_hint=(
            "70s Funk 律动：切分 slap bass 为主心骨，明亮电吉他 wah 点缀，"
            "紧致 hi-hat 与干鼓组，铜管乐短促点缀；前奏从 groove 切入，主段活泼有弹性。"
        ),
        fallback_prompt=(
            "一首 70s Funk 纯器乐：切分 slap bass 驱动律动，明亮 wah 电吉他点缀，"
            "紧致 hi-hat 干鼓组，铜管乐短促呼应；前奏直接进 groove，主段活泼有弹性；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-14.0,
        bpm_hint=108,
        hook_kind="percussive", drum_kit="groove", drum_preset=0,
    ),
    "oriental": StyleSpec(
        id="oriental",
        label="东方禅意",
        drum_voices=("woodblock_short", "timpani_long"),
        music_hint=(
            "中式东方禅意器乐：古筝或琵琶主奏，竹笛或箫远处呼应，木鱼与低堂鼓稀疏点缀，"
            "五声音阶、空灵留白、山水意境；前奏克制、主段旋律婉转。"
        ),
        fallback_prompt=(
            "一首中式东方禅意纯器乐：古筝或琵琶主奏，竹笛箫远处呼应，"
            "木鱼与低堂鼓稀疏点缀，五声音阶，空灵留白；前奏克制，主段婉转悠远；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-14.0,
        bpm_hint=82,
        key_root="D", key_scale="minor_pent", hook_timbre="koto", hook_octave=4,
    ),
    "dream_pop": StyleSpec(
        id="dream_pop",
        label="梦境迷幻",
        drum_voices=("bell_short", "sub_kick_long"),
        music_hint=(
            "梦幻 dream-pop / future-bass 气质：闪烁铃铛与玻璃音色铺陈，宽阔 reverb pad，"
            "切过的合成 chords，低频 sub 托底；前奏梦幻飘忽，主段推入甜美高潮。"
        ),
        fallback_prompt=(
            "一首梦幻 dream-pop 纯器乐：闪烁铃铛与玻璃音色铺陈，宽阔 reverb pad，"
            "切片合成 chords，低频 sub 托底；前奏梦幻飘忽，主段推入甜美高潮；"
            "全曲纯器乐，不要任何人声。"
        ),
        drum_overlay_db=-15.0,
        bpm_hint=98,
        key_root="A", key_scale="major_pent", hook_timbre="kalimba", hook_octave=5,
    ),
}

DEFAULT_STYLE_ID = "healing"


def resolve(style_id: Optional[str]) -> StyleSpec:
    if not style_id:
        return STYLES[DEFAULT_STYLE_ID]
    return STYLES.get(style_id, STYLES[DEFAULT_STYLE_ID])


def list_styles() -> list[dict]:
    return [{"id": s.id, "label": s.label} for s in STYLES.values()]
