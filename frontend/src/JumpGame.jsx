import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  RotateCcw, Trophy, Play as PlayIcon, Sparkles, ShieldCheck, Star, Wind, Crown, BookOpen, X,
  Music2, Volume2, VolumeX, Check, MoreHorizontal, GraduationCap, Home,
} from 'lucide-react';
import { apiUrl } from './api.js';
import { encodeLevelCode, decodeLevelCode, normalizeMessage, SEED_MAX, MSG_MAX_LEN } from './jumpCode.js';
import SignalOwlIcon from './SignalOwlIcon.jsx';
import {
  findSweptLanding,
  jumpHeightForCharge,
  landingQuality,
  platformAcceptsSymbol,
  symbolForCharge,
} from './jumpPhysics.js';
import {
  SKILL_WORDS, findWordAtTail, findWordPrefixHints,
  getWordMnemonic, getMissionWordHint,
} from './jumpDict.js';
import {
  SUMMIT_ALT_M, ABBREV_CHALLENGES, diffOfAlt, tierOf, tierLabel,
  applyPlatformVariant, shouldSpawnSummit, createSummitPlatform,
  windStrength, inFogZone, stormIntensity, spawnMeteor, injectMissionBranch,
  displayKind, resetLevelRng, lrandom, lrand, lchoice,
  spikeSafeRange, isImpaled,
} from './jumpMechanics.js';

/* =========================================================
   JumpGame v2 — 摩斯跳一跳 · 「星途信使」未寄之信
   核心机制：
   - 蓄力 < 0.4 → 短按 ·（dot），跳跃距离 112–190
   - 蓄力 ≥ 0.4 → 长按 —（dash），跳跃距离 220–360
   - 平台三态：DOT / DASH / BOTH（间距决定能否 di / da）
   - PERFECT 落点 = 字母封箱：把符号缓冲合并为字母提交
   - 词典命中 ≥3 字母英文词 → 加分 / 触发技能
   ========================================================= */

/* ---------- 摩斯映射 ---------- */
const MORSE_MAP = {
  A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.', G:'--.', H:'....',
  I:'..', J:'.---', K:'-.-', L:'.-..', M:'--', N:'-.', O:'---', P:'.--.',
  Q:'--.-', R:'.-.', S:'...', T:'-', U:'..-', V:'...-', W:'.--', X:'-..-',
  Y:'-.--', Z:'--..',
};
const MORSE_TO_LETTER = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([l, m]) => [m, l]),
);
// 任务模式（寄一封信）专用的完整摩斯表：A-Z + 0-9 + 常用标点。
// 学习模式仍只用上面的 MORSE_MAP（A-Z），互不影响。
const FULL_MORSE = {
  ...MORSE_MAP,
  0:'-----', 1:'.----', 2:'..---', 3:'...--', 4:'....-',
  5:'.....', 6:'-....', 7:'--...', 8:'---..', 9:'----.',
  '.':'.-.-.-', ',':'--..--', '?':'..--..', "'":'.----.', '!':'-.-.--',
  '/':'-..-.', '(':'-.--.', ')':'-.--.-', '&':'.-...', ':':'---...',
  ';':'-.-.-.', '=':'-...-', '+':'.-.-.', '-':'-....-', '_':'..--.-',
  '"':'.-..-.', '@':'.--.-.', '$':'...-..-',
};
/** 任务模式取字符摩斯码：空格返回 ''（空格不发码，是词间停顿）。 */
const missionMorse = (ch) => (ch === ' ' ? '' : (FULL_MORSE[ch] || ''));
const MORSE_PREFIXES = (() => {
  const s = new Set();
  Object.values(MORSE_MAP).forEach((m) => {
    for (let i = 1; i <= m.length; i++) s.add(m.slice(0, i));
  });
  return s;
})();
const isValidPrefix = (buf) => MORSE_PREFIXES.has(buf);
const decodeLetter  = (buf) => MORSE_TO_LETTER[buf] || null;
const prettyMorse   = (buf) => buf.replace(/\./g, '·').replace(/-/g, '—');

/* ---------- 寄信成功：按单词的主题庆祝特效 ---------- */
const MISSION_THEMES = {
  LOVE:  { kind:'heart', glyph:'❤', colors:['#ff6f91','#ff9bb3','#ffd0dc'], count:22, sizeMin:14, sizeMax:26, title:'满载爱意',   sub:'裹着心跳寄出',   accent:'#ff9bb3' },
  SNOW:  { kind:'snow',  glyph:'❄', colors:['#ffffff','#e0f2fe','#bae6fd'], count:36, sizeMin:10, sizeMax:20, title:'初雪落下',   sub:'雪花陪信同行',   accent:'#bae6fd' },
  RAIN:  { kind:'rain',  glyph:'',  colors:['#7dd3fc','#38bdf8','#a5f3fc'], count:44, sizeMin:0,  sizeMax:0,  title:'细雨绵绵',   sub:'一场温柔的雨',   accent:'#7dd3fc' },
  STAR:  { kind:'star',  glyph:'✦', colors:['#fff5d8','#fde68a','#fef3c7'], count:26, sizeMin:10, sizeMax:22, title:'星河为证',   sub:'流星划过夜空',   accent:'#fde68a' },
  MOON:  { kind:'float', glyph:'🌙', colors:['#e9d5ff','#c4b5fd','#ddd6fe'], count:16, sizeMin:16, sizeMax:26, title:'皓月当空',   sub:'月色为信镀银',   accent:'#c4b5fd' },
  DREAM: { kind:'star',  glyph:'✧', colors:['#c4b5fd','#a5b4fc','#e9d5ff'], count:26, sizeMin:10, sizeMax:22, title:'好梦成真',   sub:'愿望轻轻发芽',   accent:'#c4b5fd' },
  HOME:  { kind:'float', glyph:'🏡', colors:['#fde68a','#fed7aa','#fef3c7'], count:14, sizeMin:16, sizeMax:24, title:'平安到家',   sub:'灯火为你留',     accent:'#fde68a' },
  FIRE:  { kind:'snow',  glyph:'🔥', colors:['#fdba74','#fb923c','#fca5a5'], count:24, sizeMin:14, sizeMax:24, title:'热烈似火',   sub:'火光照亮归途',   accent:'#fdba74' },
  _default: { kind:'confetti', glyph:'✦', colors:['#f2d27a','#fde68a','#fff2c8','#a7f3d0'], count:28, sizeMin:10, sizeMax:20, title:'心意送达', sub:'这封信已抵达星空', accent:'#f2d27a' },
};
const getMissionTheme = (word) => MISSION_THEMES[(word || '').toUpperCase()] || MISSION_THEMES._default;

/* ---------- 持久化 ---------- */
const STORAGE_KEY     = 'morse-jump-best-v2';
const LEADERBOARD_KEY = 'morse-jump-board-v1';
const SUMMIT_KEY      = 'morse-jump-summit-v1';
const MAX_BOARD_ROWS  = 20;

const loadBoard = () => {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
};
const saveBoard = (entries) => {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries)); } catch (_) {}
};

/** 与声印页「我的收藏」共用 */
const SAVED_TRACKS_KEY = 'morse-saved-tracks';
const BGM_PREFS_KEY    = 'morse-jump-bgm-v1';

const loadSavedTracksForBgm = () => {
  try {
    const raw = localStorage.getItem(SAVED_TRACKS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
};

const resolveTrackPlayUrl = (track) => {
  if (!track) return '';
  const raw = track.stream_url || track.audio_url || '';
  if (!raw) return '';
  if (raw.startsWith('http')) return raw;
  if (__OFFLINE__) {
    // 离线包用相对 base，收藏曲目直接按相对路径播放
    const base = import.meta.env.BASE_URL || './';
    return base.replace(/\/$/, '/') + raw.replace(/^\//, '');
  }
  return apiUrl(raw.startsWith('/') ? raw : `/${raw}`);
};

/* ---------- 触觉 ---------- */
const haptic = (pattern = 8) => {
  if (typeof navigator === 'undefined') return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
};

/* ---------- Web Audio ---------- */
let _audioCtx = null;
const _ensureCtx = () => {
  if (_audioCtx) return _audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    _audioCtx = Ctx ? new Ctx() : null;
  } catch (_) { _audioCtx = null; }
  return _audioCtx;
};
const _blip = (freq, dur = 0.12, type = 'triangle', vol = 0.16, slideTo = null) => {
  const ctx = _ensureCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo != null) osc.frequency.linearRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch (_) {}
};
const sndJump    = (long) => _blip(long ? 360 : 540, long ? 0.20 : 0.12, 'triangle', 0.16, long ? 760 : 920);
const sndLand    = ()     => _blip(620, 0.10, 'sine', 0.14);
const sndEdge    = ()     => _blip(460, 0.09, 'triangle', 0.09, 560);
const sndPerfect = ()     => { _blip(1175, 0.10, 'sine', 0.14); setTimeout(() => _blip(1568, 0.16, 'sine', 0.14), 70); };
const sndOver    = ()     => _blip(220, 0.36, 'sawtooth', 0.18, 80);
const sndLetter  = ()     => { _blip(880, 0.08, 'sine', 0.12); setTimeout(() => _blip(1320, 0.10, 'sine', 0.12), 50); };
const sndWord    = ()     => { [880, 1175, 1568, 2093].forEach((f, i) => setTimeout(() => _blip(f, 0.18, 'triangle', 0.13), i * 70)); };
const sndSkill   = ()     => { [1568, 1976, 2349, 2637].forEach((f, i) => setTimeout(() => _blip(f, 0.22, 'sine', 0.15), i * 60)); };
const sndInvalid = ()     => _blip(180, 0.12, 'sawtooth', 0.10, 140);
const sndTick    = ()     => _blip(1046, 0.05, 'square', 0.07);
const sndSeal    = ()     => { _blip(523, 0.09, 'sine', 0.15); setTimeout(() => _blip(784, 0.14, 'sine', 0.15), 60); };
const sndVictory = ()     => { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => _blip(f, 0.26, 'triangle', 0.14), i * 90)); };
const sndRetry   = ()     => _blip(330, 0.18, 'sine', 0.12, 262);
const playMorseCode = (code) => {
  if (!code) return;
  let t = 0;
  code.split('').forEach((c) => {
    const dur = c === '-' ? 0.22 : 0.1;
    setTimeout(() => _blip(c === '-' ? 380 : 620, dur, 'sine', 0.12), t);
    t += (dur + 0.14) * 1000;
  });
};

/* ---------- 物理常量（竖屏登云版） ---------- */
const GRAVITY        = 1800;
const MIN_HOLD_MS    = 80;
const MAX_HOLD_MS    = 1000;   // 蓄满只要 1 秒，节奏快
const SYMBOL_SPLIT   = 0.40;
const HOLD_RANGE_MS  = MAX_HOLD_MS - MIN_HOLD_MS;

const holdRatioFromMs = (heldMs) =>
  Math.max(0, Math.min(1, (heldMs - MIN_HOLD_MS) / HOLD_RANGE_MS));

/** 蓄力条双区填充：左半 ·、右半 — 各自 0→100%，避免单条后半段视觉猛冲 */
const chargeBarFills = (ratio) => {
  const dotFill = Math.min(1, ratio / SYMBOL_SPLIT);
  const dashFill = ratio <= SYMBOL_SPLIT
    ? 0
    : Math.min(1, (ratio - SYMBOL_SPLIT) / (1 - SYMBOL_SPLIT));
  return { dotFill, dashFill };
};
const MAX_JUMP_DIST  = 360;    // 最大升空高度
const PERFECT_TOL_PX = 13;
const CLOUD_CORE_H   = 15;     // 云台核心视觉厚度
const characterAnchorRatio = (height) => {
  if (height < 360) return 0.43;
  if (height < 480) return 0.53;
  return 0.64;
};

/* ---------- 台球式瞄准（左右角度，按住后左右拖动手动控制）---------- */
const AIM_DRAG_FULL_PX = 120;  // 手指横向拖动多少像素达到满偏（±1）
const AIM_MAX_DX      = 150;    // 满角 + 满蓄力时的最大横向位移（世界单位）
const AIM_SNAP_X_PAD  = 26;    // 落点吸附：允许比云半宽多出的横向容差

/* ---------- 角色尺寸 ---------- */
const OWL_W = 30;
const OWL_H = 42;

const rand   = (min, max) => min + Math.random() * (max - min);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

const buildLaunchPlan = (s, ratio, forceTarget = false) => {
  const symbol = symbolForCharge(ratio, SYMBOL_SPLIT);
  const fromIdx = s.standIdx;
  const next = s.platforms[fromIdx + 1];
  const targetGap = next ? next.y - s.character.alt : 0;
  const accepts = platformAcceptsSymbol(next, symbol);
  let height = jumpHeightForCharge(ratio, targetGap, accepts || forceTarget, SYMBOL_SPLIT);

  const aimNorm = Math.max(-1, Math.min(1, s.aimNorm ?? 0));
  const reach = 0.45 + 0.55 * ratio;
  let x1 = s.character.x + aimNorm * AIM_MAX_DX * reach;
  let snappedIdx = -1;

  if (forceTarget && next) {
    x1 = next.cx;
    snappedIdx = fromIdx + 1;
    height = Math.max(height, targetGap + 30);
  } else if (next) {
    const layerY = next.y;
    let bestDist = Infinity;
    for (let i = fromIdx + 1; i < Math.min(s.platforms.length, fromIdx + 5); i += 1) {
      const platform = s.platforms[i];
      if (!platform || platform.broken || Math.abs(platform.y - layerY) > 12) continue;
      const dist = Math.abs(platform.cx - x1);
      if (dist < platform.w / 2 + AIM_SNAP_X_PAD && dist < bestDist) {
        bestDist = dist;
        snappedIdx = i;
      }
    }
    if (snappedIdx >= 0) x1 = s.platforms[snappedIdx].cx;
  }

  return { symbol, height: Math.min(MAX_JUMP_DIST, height), x1, snappedIdx, accepts, next };
};

/* =========================================================
   云台生成（世界坐标：y = 海拔，向上增大）
   升空高度分布（MIN=60, MAX=360, SPLIT=0.4）：
     · (dot)  → ratio 0~0.39  → 高度  60~177
     — (dash) → ratio 0.4~1.0 → 高度 180~360
   垂直间距编码 di / da / both：
     dot-only : gap 100-148 （短按才够得着，跳太高会穿过去）
     both     : gap 155-200 （长dot或短dash均可）
     dash-only: gap 218-255 （必须长按蓄力）
   winH = 云层厚度 = 落点容错窗口（越往上越薄）
   颜色编码：金色云=· 短按 / 蓝色云=— 长按 / 白色云=both
   ========================================================= */
const CLOUD_WIN_BASE = 92;

/** 云台尺寸档：宽/窄 + 厚度 → 不同难度 */
const CLOUD_SIZES = {
  narrow: { wRatio: 0.22, winScale: 0.68, label: '窄' },
  normal: { wRatio: 0.32, winScale: 1.00, label: '' },
  wide:   { wRatio: 0.44, winScale: 1.28, label: '宽' },
};
const CLOUD_W_MAX = 180;       // 云宽上限，避免大屏上云过宽

const pickCloudSize = (diff, forceKind) => {
  if (forceKind) return 'wide';
  const r = lrandom();
  if (diff > 0.28 && r < 0.18 + diff * 0.28) return 'narrow';
  if (r < 0.20) return 'wide';
  return 'normal';
};

/** 落台后冻结漂移云——云留在落点，不回中（保留空间记忆） */
const freezeCloudOnLand = (p, impact = 1) => {
  if (p.moving) p.moving = false;
  // 触发云体下压：给一个向下速度冲量，弹簧回弹出「云被踩软」的软垫感
  p.dipV = (p.dipV || 0) + 62 * impact;
};

const tickCloudMotion = (p, dt) => {
  if (p.moving) {
    p.phase += dt * p.speed;
    p.cx = p.baseCX + Math.sin(p.phase) * p.amp;
  }
  // 云体下压弹簧（着陆反馈，仅本云局部起伏，不影响镜头）
  if (p.dip || p.dipV) {
    const k = 118;      // 刚度（偏软 → 云感）
    const c = 11;       // 阻尼（欠阻尼 → 回弹一两下）
    p.dipV = (p.dipV || 0) + (-k * (p.dip || 0) - c * (p.dipV || 0)) * dt;
    p.dip = (p.dip || 0) + p.dipV * dt;
    p.dip = Math.max(-2, Math.min(9, p.dip)); // 限幅，避免异常
    if (Math.abs(p.dip) < 0.06 && Math.abs(p.dipV) < 0.5) { p.dip = 0; p.dipV = 0; }
  }
};

const buildInitialPlatforms = (vw) => {
  const p0 = { y: 0, cx: vw / 2, w: 180, winH: 110, kind: 'both', hue: 38, isStart: true, sizeKey: 'wide' };
  const next = nextPlatform(p0, 'both', [], 0, vw);
  return [p0, next];
};

const nextPlatform = (prev, forceKind = null, lastKinds = [], diff = 0, vw = 360, altM = 0) => {
  let kind = forceKind;
  if (!kind) {
    const bothN = Math.max(3, 6 - Math.round(diff * 3));
    const specN = 2 + Math.round(diff * 2);
    const candidates = [
      ...Array(bothN).fill('both'),
      ...Array(specN).fill('dot'),
      ...Array(specN).fill('dash'),
    ];
    const last2 = lastKinds.slice(-2);
    const pool = candidates.filter(k =>
      !(last2.length === 2 && last2[0] === k && last2[1] === k)
    );
    kind = lchoice(pool);
  }
  let gap;
  if (kind === 'dot')       gap = lrand(100, 148);
  else if (kind === 'dash') gap = lrand(218, 255);
  else                      gap = lrand(155, 200);

  const sizeKey = pickCloudSize(diff, forceKind === 'both' && diff < 0.1);
  const size = CLOUD_SIZES[sizeKey];
  const winH = Math.max(46, (CLOUD_WIN_BASE - diff * 30) * size.winScale + lrand(-4, 4));
  // 台球玩法：横向拉开更明显，逼玩家用瞄准角度（保证仍在可达范围内）
  const spread = 78 + diff * 46;
  let cx = prev.cx + (lrandom() < 0.5 ? -1 : 1) * lrand(34, spread);
  const anchor = vw / 2;
  const drift = cx - anchor;
  if (Math.abs(drift) > vw * 0.42) cx = anchor + Math.sign(drift) * vw * 0.42; // 收束回可视中带
  const p = {
    y: prev.y + gap,
    cx,
    w: Math.min(CLOUD_W_MAX, Math.max(72, vw * size.wRatio)),
    winH, kind, hue: lrand(20, 55),
    sizeKey,
  };
  // 漂移云：窄 + 横漂，落台后会滑回正中
  if (!forceKind && diff > 0.14 && lrandom() < 0.14 + diff * 0.36) {
    p.moving  = true;
    p.baseCX  = p.cx;
    p.amp     = Math.min(vw * 0.22, 36 + diff * 48);
    p.speed   = 0.85 + diff * 0.95;
    p.phase   = lrand(0, Math.PI * 2);
    p.w       = Math.min(CLOUD_W_MAX, Math.max(70, vw * CLOUD_SIZES.narrow.wRatio));
    p.winH    = Math.max(44, winH * 0.88);
    p.sizeKey = 'drift';
  }
  applyPlatformVariant(p, diff, altM, forceKind);
  if (forceKind === 'both' && diff < 0.1) p.relay = false;
  return p;
};

/* =========================================================
   「寄一封信」关卡：单词 → 摩斯符号 → 一条通天云路
   每个符号一朵云，垂直间距即点/划；字母最后一朵是「封蜡云」；
   路顶是终点信箱。发错码 = 高度不对 = 坠落 →「电报重发」。
   ========================================================= */
const buildMissionLevel = (word, vw, seed = 0) => {
  // 用 (整句 + seed) 播种关卡专用 rng：同 (word, seed) → 逐像素相同的云路。
  // 句子本身也参与播种，避免不同句碰上同一 seed 时布局雷同。
  let h = seed >>> 0;
  for (let i = 0; i < word.length; i++) h = (Math.imul(h ^ word.charCodeAt(i), 2654435761) + 1) >>> 0;
  resetLevelRng(h);
  const platforms = [{ y: 0, cx: vw / 2, w: CLOUD_W_MAX, winH: 110, kind: 'both', hue: 38, isStart: true }];
  const letterStarts = [];              // 每个字符（含空格）对应的首朵云 index
  let prev = platforms[0];
  const chars = word.split('');         // 含空格：空格是词间停顿
  // 总符号数（空格不发码）：决定云的稀薄程度
  const totalSyms = chars.reduce((n, ch) => n + missionMorse(ch).length, 0);
  // 句子越长云越薄，后段更紧张（窗口 66~92）
  const thin = Math.min(26, Math.max(0, (totalSyms - 8) * 2.4));

  const clampCx = (cx) => {
    const anchor = vw / 2;
    return Math.abs(cx - anchor) > vw * 0.4 ? anchor + Math.sign(cx - anchor) * vw * 0.4 : cx;
  };

  chars.forEach((ch, li) => {
    letterStarts.push(platforms.length);

    // 空格 → 一朵「停顿云」：词与词之间的落脚点/呼吸点（可站任意点划），略大更好落。
    if (ch === ' ') {
      const p = {
        y: prev.y + lrand(150, 178),
        cx: clampCx(prev.cx + (lrandom() < 0.5 ? -1 : 1) * lrand(20, 60)),
        w: Math.min(CLOUD_W_MAX, Math.max(120, vw * 0.44)),
        winH: 108, kind: 'both',
        letter: ' ', letterIdx: li, isSpace: true, isLetterEnd: true,
        hue: 48,
      };
      platforms.push(p);
      prev = p;
      return;
    }

    const code = missionMorse(ch);
    code.split('').forEach((sym, si) => {
      const isLetterEnd = si === code.length - 1;
      const gap = sym === '.' ? lrand(105, 145) : lrand(220, 250);
      // 台球玩法：横向拉开，逼玩家瞄准；收束在可视中带内
      const cx = clampCx(prev.cx + (lrandom() < 0.5 ? -1 : 1) * lrand(40, 96));
      const p = {
        y: prev.y + gap,
        cx,
        w: Math.min(CLOUD_W_MAX, Math.max(96, vw * (isLetterEnd ? 0.42 : 0.34))),
        winH: isLetterEnd ? 102 : Math.max(66, CLOUD_WIN_BASE - thin),
        kind: sym === '.' ? 'dot' : 'dash',
        sym, letter: ch, letterIdx: li, symIdx: si, isLetterEnd,
        hue: lrand(20, 55),
      };
      platforms.push(p);
      prev = p;
    });
  });

  platforms.push({
    y: prev.y + lrand(165, 190),
    cx: prev.cx + lrand(-28, 28),
    w: Math.min(CLOUD_W_MAX, Math.max(140, vw * 0.46)),
    winH: 128, kind: 'both', hue: 45, isGoal: true,
  });
  return { platforms: injectMissionBranch(platforms, word, vw), letterStarts, totalSyms };
};

/* =========================================================
   主组件
   ========================================================= */
const JumpGame = ({ isActive = true, onOpenLearn }) => {
  const wrapRef   = useRef(null);
  const canvasRef = useRef(null);
  const stateRef  = useRef(null);
  const rafRef    = useRef(0);
  const lastTRef  = useRef(0);
  const dprRef    = useRef(1);
  // HUD 反馈用稳定 DOM 节点（避免 key 重挂载导致的合成层残影）
  const scoreNumRef  = useRef(null);
  const scorePlusRef = useRef(null);
  const altNumRef    = useRef(null);
  const altPlusRef   = useRef(null);

  const [score, setScore]         = useState(0);
  const [altitude, setAltitude]   = useState(0);   // 已到达海拔（米）
  const [combo, setCombo]         = useState(0);
  const [best,  setBest]          = useState(0);
  const [phase, setPhase]         = useState('idle');
  const [charge, setCharge]       = useState(0);
  const [showDict, setShowDict]   = useState(false);
  const [letterBuf, setLetterBuf] = useState('');
  const [wordBuf,   setWordBuf]   = useState('');
  const [floater,   setFloater]   = useState(null);
  const [skillBanner, setSkillBanner] = useState(null);
  const [activeSkills, setActiveSkills] = useState([]);
  const [showBoard,    setShowBoard]    = useState(false);
  const [board,        setBoard]        = useState(() => loadBoard());
  const [nameInput,    setNameInput]    = useState('');
  const [nameSaved,    setNameSaved]    = useState(false);
  const pendingScoreRef = useRef(0);

  /* ---- 「寄一封信」任务模式 ---- */
  const [gameMode, setGameMode]         = useState('endless');  // 'endless' | 'mission'
  const [missionWord, setMissionWord]   = useState('');
  const [missionInput, setMissionInput] = useState('');
  const [missionSeed, setMissionSeed]   = useState(() => (Math.random() * SEED_MAX) | 0);  // 当前布局种子
  const [showMissionPanel, setShowMissionPanel] = useState(false);
  const [secretLevel, setSecretLevel]   = useState(false);      // 关卡码进入：游戏内隐藏原词，通关才揭晓
  const [levelCodeInput, setLevelCodeInput] = useState('');     // B 玩家粘贴的关卡码
  const [codeError, setCodeError]       = useState('');         // 关卡码输入错误提示
  const [showCodePanel, setShowCodePanel] = useState(false);    // 「破译关卡码」面板展开
  const [copied, setCopied]             = useState(false);      // 复制关卡码反馈
  const [revealed, setRevealed]         = useState(false);      // 保密关卡通关后是否已揭晓真词
  const [missionHUD, setMissionHUD]     = useState(null);       // {letters:[{letter,done,cur}], curLetter, curSym, lives}
  const [missionResult, setMissionResult] = useState(null);     // {word, retries, time}
  const [summitBest, setSummitBest]       = useState(null);     // {score, alt, date}
  const [zoneLabel, setZoneLabel]         = useState('晴空');
  const [owlPreview, setOwlPreview]       = useState([]);

  const bgmRef = useRef(null);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showBgmPicker, setShowBgmPicker] = useState(false);
  const [savedBgmList, setSavedBgmList]   = useState([]);
  const [bgmTrack, setBgmTrack]           = useState(null);
  const [bgmMuted, setBgmMuted]           = useState(false);
  const [godMode, setGodMode]             = useState(false);  // 管理员测试：无敌，不会坠落
  const godRef = useRef(false);
  useEffect(() => { godRef.current = godMode; }, [godMode]);

  /** 顶部联想：已拼字母 → 可能完成的词 */
  const wordHints = useMemo(() => findWordPrefixHints(wordBuf, 3), [wordBuf]);

  /** 寄信成功：主题庆祝层的粒子（按单词生成一次） */
  const celebration = useMemo(() => {
    if (phase !== 'victory' || !missionResult || missionResult.summit) return null;
    const theme = getMissionTheme(missionResult.word);
    const bits = Array.from({ length: theme.count }).map((_, i) => {
      const size = theme.sizeMin + Math.random() * Math.max(1, theme.sizeMax - theme.sizeMin);
      return {
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        dur: 2.6 + Math.random() * 2.4,
        drift: (Math.random() - 0.5) * 60,
        size,
        rot: Math.random() * 360,
        color: theme.colors[i % theme.colors.length],
        opacity: 0.65 + Math.random() * 0.35,
      };
    });
    return { theme, bits };
  }, [phase, missionResult]);
  const letterHint = useMemo(() => {
    if (!letterBuf) return '';
    const letter = decodeLetter(letterBuf);
    if (letter) return getWordMnemonic(letter) || `字母 ${letter}`;
    return isValidPrefix(letterBuf) ? '摩斯未完…' : '';
  }, [letterBuf]);

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(BGM_PREFS_KEY) || 'null');
      if (!prefs?.audio_url) return;
      const list = loadSavedTracksForBgm();
      const t = list.find((x) => x.audio_url === prefs.audio_url);
      if (t) setBgmTrack(t);
    } catch (_) {}
  }, []);

  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    const onErr = () => {
      setBgmTrack(null);
      try { localStorage.removeItem(BGM_PREFS_KEY); } catch (_) {}
    };
    el.addEventListener('error', onErr);
    return () => el.removeEventListener('error', onErr);
  }, []);

  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    if (!bgmTrack) {
      el.pause();
      el.removeAttribute('src');
      el.removeAttribute('data-bgm-src');
      try { el.load(); } catch (_) {}
      return;
    }
    const url = resolveTrackPlayUrl(bgmTrack);
    if (!url) return;
    el.loop = true;
    if (el.getAttribute('data-bgm-src') !== url) {
      el.setAttribute('data-bgm-src', url);
      el.src = url;
      el.load();
    }
    el.volume = bgmMuted ? 0 : 0.38;
    if (isActive) {
      const p = el.play();
      if (p) p.catch(() => {});
    } else {
      el.pause();
    }
  }, [bgmTrack, bgmMuted, isActive]);

  const openBgmPicker = useCallback(() => {
    setSavedBgmList(loadSavedTracksForBgm());
    setShowToolsMenu(false);
    setShowBgmPicker(true);
  }, []);

  const selectBgmTrack = useCallback((track) => {
    setBgmTrack(track);
    try {
      localStorage.setItem(BGM_PREFS_KEY, JSON.stringify({ audio_url: track.audio_url }));
    } catch (_) {}
    setShowBgmPicker(false);
    haptic(8);
  }, []);

  const clearBgmTrack = useCallback(() => {
    setBgmTrack(null);
    try { localStorage.removeItem(BGM_PREFS_KEY); } catch (_) {}
    setShowBgmPicker(false);
    haptic(4);
  }, []);

  const toggleBgmMute = useCallback(() => {
    setBgmMuted((m) => !m);
    haptic(4);
  }, []);

  useEffect(() => {
    const entries = loadBoard();
    const boardBest = entries.reduce((m, e) => Math.max(m, e.score), 0);
    try {
      const legacy = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      setBest(Math.max(boardBest, isNaN(legacy) ? 0 : legacy));
      const sb = JSON.parse(localStorage.getItem(SUMMIT_KEY) || 'null');
      if (sb?.score) setSummitBest(sb);
    } catch (_) { setBest(boardBest); }
  }, []);

  useEffect(() => {
    if (!floater) return;
    const t = setTimeout(() => setFloater(null), floater.big ? 1500 : 1200);
    return () => clearTimeout(t);
  }, [floater]);

  // 用 Web Animations API 在稳定节点上播放弹跳/飘字，避免重挂载残影
  const bumpNumber = (el) => {
    if (!el) return;
    el.animate(
      [{ transform: 'scale(1)', filter: 'brightness(1)' },
       { transform: 'scale(1.16)', filter: 'brightness(1.35)', offset: 0.32 },
       { transform: 'scale(1)', filter: 'brightness(1)' }],
      { duration: 420, easing: 'cubic-bezier(0.22,1,0.36,1)' },
    );
  };
  const flyPlus = (el, text, opts = {}) => {
    if (!el) return;
    el.textContent = text;
    const mag = opts.mag || 1;          // 1 小 / 2 中 / 3 大
    const peakScale = 1.15 + (mag - 1) * 0.22;
    const rise = 22 + (mag - 1) * 14;
    if (opts.color) el.style.color = opts.color;
    el.style.textShadow = mag >= 3 ? '0 0 12px rgba(255,240,200,0.9)'
      : mag >= 2 ? '0 0 8px rgba(242,210,122,0.7)' : 'none';
    el.animate(
      [{ opacity: 0, transform: 'translateY(6px) scale(0.7)' },
       { opacity: 1, transform: `translateY(-2px) scale(${peakScale})`, offset: 0.22 },
       { opacity: 0, transform: `translateY(-${rise}px) scale(1)` }],
      { duration: 820 + (mag - 1) * 160, easing: 'cubic-bezier(0.22,1,0.36,1)' },
    );
  };

  const popScoreGain = useCallback((n) => {
    if (n <= 0) return;
    bumpNumber(scoreNumRef.current);
    const mag = n >= 40 ? 3 : n >= 14 ? 2 : 1;
    const color = mag >= 3 ? '#fff5d8' : mag >= 2 ? '#f2d27a' : '#a7f3d0';
    flyPlus(scorePlusRef.current, `+${n}`, { mag, color });
    haptic(n >= 40 ? [10, 30, 10, 30] : n >= 8 ? [8, 24, 8] : 6);
  }, []);

  const popAltGain = useCallback((prevAlt, nextAlt) => {
    const d = nextAlt - prevAlt;
    if (d >= 8) {
      bumpNumber(altNumRef.current);
      flyPlus(altPlusRef.current, `+${d}`);
    }
  }, []);

  useEffect(() => {
    if (!skillBanner) return;
    const t = setTimeout(() => setSkillBanner(null), 1500);
    return () => clearTimeout(t);
  }, [skillBanner]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    dprRef.current = dpr;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width  = Math.round(r.width  * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width  = r.width  + 'px';
      canvas.style.height = r.height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current) stateRef.current.viewport = { w: r.width, h: r.height };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const syncActiveSkillsHUD = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    const list = [];
    if (s.skills.shield)         list.push({ kind: 'sos',  label: 'SOS · 护盾',     icon: 'shield' });
    if (s.skills.winNext)        list.push({ kind: 'win',  label: 'WIN · 下跳必中', icon: 'crown'  });
    if (s.skills.skyNext)        list.push({ kind: 'sky',  label: 'SKY · 下块超宽', icon: 'wind'   });
    if (s.skills.goldRemain > 0) list.push({ kind: 'gold', label: `GOLD ×2 · ${s.skills.goldRemain}跳`, icon: 'star' });
    if (s.skills.owlReveal > 0)  list.push({ kind: 'owl',  label: `OWL · 预览${s.skills.owlReveal}`, icon: 'owl' });
    if (s.skills.moonRemain > 0) list.push({ kind: 'moon', label: `MOON · ${s.skills.moonRemain}跳`, icon: 'moon' });
    if (s.skills.rainRemain > 0) list.push({ kind: 'rain', label: `RAIN · ${s.skills.rainRemain}朵`, icon: 'rain' });
    if (s.skills.foxBlur > 0)    list.push({ kind: 'fox',  label: `FOX · ${s.skills.foxBlur}跳`, icon: 'fox' });
    if (s.skills.codeFix > 0)    list.push({ kind: 'code', label: 'CODE · 纠错', icon: 'code' });
    setActiveSkills(list);
  }, []);

  /* 任务 HUD：单词进度（哪些字母已封蜡、当前符号位置）+ 剩余机会 */
  const syncMissionHUD = useCallback(() => {
    const s = stateRef.current;
    if (!s?.mission) { setMissionHUD(null); return; }
    const { word, letterStarts, curIdx, lives } = s.mission;
    const letters = word.split('').map((letter, li) => {
      const startIdx = letterStarts[li];
      const endIdx = (li + 1 < letterStarts.length ? letterStarts[li + 1] : s.platforms.length - 1) - 1;
      const code = missionMorse(letter);
      return {
        letter,
        isSpace: letter === ' ',
        done: curIdx > endIdx,
        active: curIdx >= startIdx && curIdx <= endIdx,
        code,
        symDone: Math.max(0, Math.min(curIdx - startIdx, code.length)),
      };
    });
    setMissionHUD({ letters, lives });
  }, []);

  const reset = useCallback((mode = 'endless', word = '', secret = false, seed = 0) => {
    const wrap = wrapRef.current;
    const r = wrap?.getBoundingClientRect();
    const vw = r?.width || 360;
    let platforms;
    let mission = null;
    if (mode === 'mission' && word) {
      const lvl = buildMissionLevel(word, vw, seed);
      platforms = lvl.platforms;
      mission = {
        word,
        secret,
        seed,
        letterStarts: lvl.letterStarts,
        totalSyms: lvl.totalSyms,
        curIdx: 1,          // 下一个要落的云 index（0 是起点云）
        retries: 0,
        lives: 3,
        startTime: performance.now(),
      };
    } else {
      resetLevelRng();               // 固定种子 → 无尽模式每局云路完全一致（可背板）
      platforms = buildInitialPlatforms(vw);
    }
    stateRef.current = {
      viewport: { w: vw, h: r?.height || 600 },
      platforms,
      kindHistory: ['both', 'both'],
      cameraY: 0,
      cameraX: vw / 2,
      mode,
      mission,
      standIdx: 0,          // 当前站立的云 index
      character: {
        x: vw / 2,
        alt: 0,
        rot: 0,
        squash: 0,
        wingOpen: 0,
        wingBurst: 0,
        flapPhase: 0,
        landingEase: 0,
        landOffset: 0,        // 落地吸附缓冲（世界单位，>0 表示仍在落点线上方）
        landOffsetV: 0,       // 缓冲弹簧速度
        pose: 'idle',
        landed: true,
        blink: 0,
        blinkTimer: rand(2.0, 4.0),
        aimLean: 0,           // 瞄准倾身 (-1 左 ~ +1 右)，蓄力时朝发射方向倾斜
      },
      jump: null,
      hold: null,
      aimNorm: 0,
      aimPull: 0,             // 弹弓皮筋拉伸量 0~1，蓄力+偏角越大越明显
      sparks: [],
      rings: [],
      shake: 0,
      flash: 0,
      score: 0,
      combo: 0,
      ended: false,
      letterBuf: '',
      wordBuf: '',
      skills: {
        shield: false,
        winNext: false,
        skyNext: false,
        goldRemain: 0,
        owlReveal: 0,
        moonRemain: 0,
        rainRemain: 0,
        foxBlur: 0,
        codeFix: 0,
      },
      env: {
        meteors: [],
        stormFlash: 0,
        abbrevHint: null,
        summitSpawned: false,
      },
      fragileTimer: 0,
      smoothCharge: 0,
      startTime: performance.now(),
    };
    setScore(0);
    setAltitude(0);
    setCombo(0);
    setCharge(0);
    setLetterBuf('');
    setWordBuf('');
    setFloater(null);
    setSkillBanner(null);
    setMissionResult(null);
    setZoneLabel('晴空');
    setOwlPreview([]);
    syncActiveSkillsHUD();
    syncMissionHUD();
  }, [syncActiveSkillsHUD, syncMissionHUD]);

  const startGame = useCallback((mode = 'endless', word = '', opts = {}) => {
    cancelAnimationFrame(rafRef.current);
    lastTRef.current = 0;
    setGameMode(mode);
    setMissionWord(word);
    const secret = mode === 'mission' && !!opts.secret;
    setSecretLevel(secret);
    // 任务模式：seed 决定布局。外部传入（破译/重来）则复用，否则随机取一个新布局。
    const seed = mode === 'mission'
      ? (Number.isFinite(opts.seed) ? (opts.seed >>> 0) % SEED_MAX : (Math.random() * SEED_MAX) | 0)
      : 0;
    setMissionSeed(seed);
    reset(mode, word, secret, seed);
    setPhase('playing');
    haptic(8);
  }, [reset]);

  const startMission = useCallback(() => {
    const w = normalizeMessage(missionInput);   // 大写 + 仅保留可编码字符 + 并空格 + 长度校验
    if (!w) {
      haptic([10, 30, 10]);
      sndInvalid();
      return;
    }
    startGame('mission', w, { seed: missionSeed });   // 用当前布局种子 → 与展示的分享码一致
  }, [missionInput, missionSeed, startGame]);

  /** B 玩家：粘贴关卡码 → 解码出「单词 + seed」→ 进入保密关卡（复现 A 的布局，不显示原词） */
  const startCodeChallenge = useCallback(() => {
    const { ok, word, seed } = decodeLevelCode(levelCodeInput);
    if (!ok) {
      setCodeError('关卡码无效，请检查后重试');
      haptic([10, 30, 10]);
      sndInvalid();
      return;
    }
    setCodeError('');
    startGame('mission', word, { secret: true, seed });
  }, [levelCodeInput, startGame]);

  /** A 玩家当前输入词 + 当前布局种子对应的关卡码（供分享，B 解出后逐像素复现同一关卡） */
  const missionCode = useMemo(
    () => encodeLevelCode(missionInput, missionSeed),
    [missionInput, missionSeed],
  );

  /** 换一个布局：同词换 seed → 关卡与关卡码同时变（仍可被复现） */
  const rerollMission = useCallback(() => {
    setMissionSeed((Math.random() * SEED_MAX) | 0);
    haptic(6);
  }, []);

  /** 复制关卡码到剪贴板 */
  const copyCode = useCallback(() => {
    if (!missionCode) return;
    const done = () => { setCopied(true); haptic(8); setTimeout(() => setCopied(false), 1600); };
    if (__OFFLINE__) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(missionCode).then(done, done);
      } else {
        window.prompt('复制这串关卡码', missionCode);
        done();
      }
    } catch (_) { done(); }
  }, [missionCode]);

  const gameOver = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.ended) return;
    s.ended = true;
    const finalScore = s.score;
    sndOver();
    haptic([24, 40, 24]);
    pendingScoreRef.current = finalScore;
    setNameInput('');
    setNameSaved(false);
    setPhase('over');
    setBest((b) => {
      const nb = Math.max(b, finalScore);
      try { localStorage.setItem(STORAGE_KEY, String(nb)); } catch (_) {}
      return nb;
    });
  }, []);

  /* 无尽登顶：抵达星空之门 */
  const summitVictory = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.ended) return;
    s.ended = true;
    sndVictory();
    haptic([12, 40, 12, 40, 20]);
    const elapsed = Math.round((performance.now() - (s.startTime || performance.now())) / 1000);
    const altM = Math.round(s.character.alt / 6);
    const payload = { score: s.score, alt: altM, time: elapsed, date: new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) };
    setMissionResult({ word: 'SUMMIT', retries: 0, time: elapsed, score: s.score, alt: altM, summit: true });
    try {
      const prev = JSON.parse(localStorage.getItem(SUMMIT_KEY) || 'null');
      if (!prev || s.score > (prev.score || 0)) localStorage.setItem(SUMMIT_KEY, JSON.stringify(payload));
      setSummitBest((b) => ((!b || s.score > b.score) ? payload : b));
    } catch (_) {}
    for (let i = 0; i < 100; i++) {
      s.sparks.push(...spawnSparks(rand(0, s.viewport.w), s.character.alt + rand(-80, 120), choice([24, 38, 50]), { glow: 0.8, big: true }));
    }
    s.rings.push(makeRing(s.character.x, s.character.alt, { r0: 20, r1: 200, width: 3, color: '255,245,216', life: 0.9 }));
    s.flash = 1;
    s.shake = 9;
    setPhase('victory');
  }, []);

  /* 任务完成：信送达 */
  const missionVictory = useCallback(() => {
    const s = stateRef.current;
    if (!s?.mission || s.ended) return;
    s.ended = true;
    sndVictory();
    haptic([12, 40, 12, 40, 20]);
    const elapsed = Math.round((performance.now() - s.mission.startTime) / 1000);
    setMissionResult({ word: s.mission.word, retries: s.mission.retries, time: elapsed, score: s.score, secret: s.mission.secret, seed: s.mission.seed });
    setRevealed(false);
    // 满屏流星庆祝
    for (let i = 0; i < 80; i++) {
      s.sparks.push(...spawnSparks(
        rand(0, s.viewport.w),
        s.character.alt + rand(-s.viewport.h * 0.2, s.viewport.h * 0.5),
        choice([24, 38, 50]),
        { glow: 0.8, big: true },
      ));
    }
    s.rings.push(makeRing(s.character.x, s.character.alt, { r0: 20, r1: 180, width: 3, color: '242,210,122', life: 0.9 }));
    s.flash = 0.9;
    s.shake = 8;
    setPhase('victory');
  }, []);

  /* 任务模式：发错码 → 电报重发（扣一次机会，回到当前字母起点重试） */
  const missionRetry = useCallback((now) => {
    const s = stateRef.current;
    if (!s?.mission) return;
    s.mission.lives -= 1;
    s.mission.retries += 1;
    if (s.mission.lives <= 0) {
      s.fall = null;
      gameOver();
      return;
    }
    // 回到当前字母第一个符号之前的云（字母起点的前一格）
    const { letterStarts, curIdx } = s.mission;
    let letterStart = letterStarts[0];
    for (const st of letterStarts) { if (st <= curIdx) letterStart = st; else break; }
    const respawnIdx = Math.max(0, letterStart - 1);
    const p = s.platforms[respawnIdx];
    s.mission.curIdx = letterStart;
    s.fall = null;
    s.jump = null;
    s.standIdx = respawnIdx;
    s.character.x = p.cx;
    s.cameraX = p.cx;
    s.character.alt = p.y;
    s.character.rot = 0;
    s.character.landed = true;
    s.character.landOffset = 0;
    s.character.landOffsetV = 0;
    sndRetry();
    haptic([16, 30, 16]);
    setFloater({ text: '⚡ 电报重发', sub: `剩余 ${s.mission.lives} 次机会`, color: '#fca5a5', key: now });
    syncMissionHUD();
  }, [gameOver, syncMissionHUD]);

  const onLandingSymbol = useCallback((sym, isPerfect, now) => {
    const s = stateRef.current;
    if (!s) return;
    const cand = s.letterBuf + sym;
    if (isValidPrefix(cand)) {
      s.letterBuf = cand;
    } else {
      if (s.skills.codeFix > 0) {
        s.skills.codeFix = 0;
        s.letterBuf = sym;
        syncActiveSkillsHUD();
        setFloater({ text: 'CODE 纠错', sub: prettyMorse(sym), color: '#86efac', key: now });
      } else {
        s.letterBuf = sym;
        sndInvalid();
        setFloater({ text: '× 无效', sub: prettyMorse(cand), color: '#fca5a5', key: now });
      }
    }
    let commit = isPerfect || s.letterBuf.length >= 4;
    if (commit) {
      const letter = decodeLetter(s.letterBuf);
      if (letter) commitLetter(letter, now);
      else {
        sndInvalid();
        setFloater({ text: '× 不是字母', sub: prettyMorse(s.letterBuf), color: '#fca5a5', key: now });
      }
      s.letterBuf = '';
    }
    setLetterBuf(s.letterBuf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitLetter = (letter, now) => {
    const s = stateRef.current;
    s.wordBuf = (s.wordBuf + letter).slice(-8);
    setWordBuf(s.wordBuf);
    sndLetter();
    setFloater({ text: `+ ${letter}`, color: '#f2d27a', key: now + 1 });
    const word = findWordAtTail(s.wordBuf);
    if (word) {
      s.wordBuf = s.wordBuf.slice(0, -word.length);
      setWordBuf(s.wordBuf);
      triggerWord(word, now);
    }
  };

  const triggerWord = (word, now) => {
    const s = stateRef.current;
    const skill = SKILL_WORDS[word];
    const baseBonus = word.length * 10;
    if (skill) {
      sndSkill();
      haptic([10, 28, 10, 28, 10]);
      s.score += baseBonus;
      setScore(s.score);
      popScoreGain(baseBonus);
      activateSkill(skill.kind, now);
      setSkillBanner({ word, desc: skill.desc, color: skill.color, key: now });
      for (let i = 0; i < 24; i++) {
        s.sparks.push(...spawnSparks(s.character.x + rand(-40, 40), s.character.alt + rand(0, 80), choice([24, 38, 50]), { glow: 0.8 }));
      }
      s.rings.push(makeRing(s.character.x, s.character.alt, { r0: 12, r1: 120, width: 3, color: '255,245,216', life: 0.7 }));
      s.flash = 0.7;
      s.shake = 7;
    } else {
      sndWord();
      haptic([8, 22, 8]);
      s.score += baseBonus;
      setScore(s.score);
      popScoreGain(baseBonus);
      setSkillBanner({ word, desc: `+${baseBonus}`, color: '#f2d27a', key: now });
      s.sparks.push(...spawnSparks(s.character.x, s.character.alt + 4, 38));
      s.shake = 4;
    }
  };

  const activateSkill = (kind, now) => {
    const s = stateRef.current;
    switch (kind) {
      case 'star': {
        s.score += 50;
        setScore(s.score);
        popScoreGain(50);
        for (let i = 0; i < 60; i++) {
          s.sparks.push(...spawnSparks(rand(0, s.viewport.w),
                                       s.character.alt + rand(-s.viewport.h * 0.1, s.viewport.h * 0.5), choice([24, 38, 50])));
        }
        s.shake = 7;
        break;
      }
      case 'win':  s.skills.winNext = true; break;
      case 'gold': s.skills.goldRemain = 5;  break;
      case 'sos':  s.skills.shield = true;   break;
      case 'sky':  s.skills.skyNext = true;  break;
      case 'fox':  s.skills.foxBlur = 3;    break;
      case 'owl':  s.skills.owlReveal = 5;  break;
      case 'moon': s.skills.moonRemain = 5;  break;
      case 'rain': s.skills.rainRemain = 5; break;
      case 'code': s.skills.codeFix = 1;   break;
      default: break;
    }
    syncActiveSkillsHUD();
  };

  const onPressDown = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    if (phase !== 'playing') return;
    const s = stateRef.current;
    if (!s) return;
    if (!s.character.landed || s.jump) return;
    const px = e?.clientX ?? e?.touches?.[0]?.clientX ?? 0;
    s.hold = { start: performance.now(), startX: px, symbol: '.' };
    s.aimNorm = 0;
    haptic(4);
  }, [phase]);

  // 弹弓式瞄准：按住后往一侧"拉"，鸟射向反方向（右下拉→左上飞）
  const onPressMove = useCallback((e) => {
    if (phase !== 'playing') return;
    const s = stateRef.current;
    if (!s || !s.hold) return;
    if (e?.preventDefault) e.preventDefault();
    const px = e?.clientX ?? e?.touches?.[0]?.clientX ?? s.hold.startX;
    const norm = -(px - s.hold.startX) / AIM_DRAG_FULL_PX;  // 取反：拉向反方向发射
    s.aimNorm = Math.max(-1, Math.min(1, norm));
  }, [phase]);

  const onPressUp = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    if (phase !== 'playing') return;
    const s = stateRef.current;
    if (!s || !s.hold) return;
    const held = Math.max(MIN_HOLD_MS, Math.min(performance.now() - s.hold.start, MAX_HOLD_MS));
    const ratio = holdRatioFromMs(held);
    s.hold = null;
    s.smoothCharge = 0;
    setCharge(0);
    s.fragileTimer = 0;

    const useWinNext = s.skills.winNext;
    const plan = buildLaunchPlan(s, ratio, useWinNext);
    const sym = plan.symbol;
    let height = plan.height;
    let T = 0.52 + ratio * 0.26;
    if (s.skills.moonRemain > 0) {
      height *= 1.28;
      T *= 1.08;
      s.skills.moonRemain -= 1;
      syncActiveSkillsHUD();
    }

    if (useWinNext) {
      T = 0.62;
      s.skills.winNext = false;
      syncActiveSkillsHUD();
    }

    s.jump = {
      alt0: s.character.alt,
      peakAlt: s.character.alt + height,
      phase: 'rise',
      t: 0, T,
      fallV: 0,
      height, sym,
      fromIdx: s.standIdx,
      x0: s.character.x,
      x1: plan.x1,
      targetAlt: plan.next?.y ?? s.character.alt,
    };
    s.character.landed = false;
    s.character.squash = 0;
    s.character.wingOpen = Math.max(s.character.wingOpen || 0, 0.58);
    s.character.wingBurst = 0.18;
    s.character.pose = 'rise';
    s.character.landingEase = 0;
    s.character.landOffset = 0;
    s.character.landOffsetV = 0;
    s.sparks.push(...spawnFlightTrail(s.character.x, s.character.alt + 6, 1.5, comboTrailTint(s.combo)));
    // 起跳能量环：长按(划)蓝、短按(点)金
    s.rings = s.rings || [];
    s.rings.push(makeRing(s.character.x, s.character.alt + 4, {
      r0: 4, r1: sym === '-' ? 40 : 26, width: 2.5,
      color: sym === '-' ? '125,211,252' : '242,210,122', life: 0.42,
    }));
    sndJump(sym === '-');
    haptic(8);
  }, [phase, syncActiveSkillsHUD]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const down = (e) => onPressDown(e);
    const move = (e) => onPressMove(e);
    const up   = (e) => onPressUp(e);
    wrap.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      wrap.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onPressDown, onPressMove, onPressUp]);

  useEffect(() => {
    if (!isActive) { cancelAnimationFrame(rafRef.current); return; }
    if (!stateRef.current) reset();

    const step = (now) => {
      const dt = Math.min(0.05, (now - (lastTRef.current || now)) / 1000);
      lastTRef.current = now;
      tick(dt, now);
      draw();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, phase]);

  const tick = (dt, now) => {
    const s = stateRef.current;
    if (!s) return;

    if (!Number.isFinite(s.character.x) || !Number.isFinite(s.character.alt) || !Number.isFinite(s.cameraY) || !Number.isFinite(s.cameraX)) {
      reset();
      return;
    }

    if (s.hold && phase === 'playing') {
      const held = now - s.hold.start;
      const target = holdRatioFromMs(held);
      const prev = s.smoothCharge ?? 0;
      const maxStep = (dt * 1000 / HOLD_RANGE_MS) * 1.04;
      s.smoothCharge = Math.min(target, prev + maxStep);
      setCharge(s.smoothCharge);
      const chargeSymbol = symbolForCharge(s.smoothCharge, SYMBOL_SPLIT);
      if (chargeSymbol !== s.hold.symbol) {
        s.hold.symbol = chargeSymbol;
        sndTick();
        haptic([7, 18, 7]);
      }
      s.character.squash = s.smoothCharge;
      // 台球式瞄准：角度由手指左右拖动决定（见 onPressMove），此处不再自动摆动。
      // 记录瞄准反馈量：猫头鹰朝发射方向（aimNorm 正=右）倾身，身后拉出弹力皮筋。
      const aim = Math.max(-1, Math.min(1, s.aimNorm ?? 0));
      s.character.aimLean += (aim - s.character.aimLean) * Math.min(1, dt * 18);
      s.aimPull = Math.min(1, Math.abs(aim) * (0.4 + s.smoothCharge * 0.6));
    } else if (Math.abs(s.character.aimLean) > 0.001) {
      // 松手后倾身平滑归零，避免姿态瞬跳
      s.character.aimLean += (0 - s.character.aimLean) * Math.min(1, dt * 14);
    }

    // 云台运动 + 环境
    const altM = Math.round(s.character.alt / 6);
    setZoneLabel(tierLabel(tierOf(altM)));
    for (const p of s.platforms) tickCloudMotion(p, dt);

    // 侧风（跳跃中横向偏移）
    const wind = windStrength(altM);
    if (s.jump && wind > 0) {
      s.jump.windX = (s.jump.windX || 0) + Math.sin(now / 420) * wind * dt * 0.35;
    }

    // 碎云倒计时
    if (s.fragileTimer > 0) {
      s.fragileTimer -= dt;
      if (s.fragileTimer <= 0) {
        const stood = s.platforms[s.standIdx];
        if (stood?.fragile) {
          stood.broken = true;
          s.character.landed = false;
          s.fall = { v: -80, fromAlt: s.character.alt, missionMiss: false };
          setFloater({ text: '碎云塌陷', sub: '快跳走！', color: '#fca5a5', key: now });
        }
        s.fragileTimer = 0;
      }
    }

    // 流星
    if (phase === 'playing' && !s.mission && Math.random() < 0.012 + stormIntensity(altM) * 0.02) {
      const m = spawnMeteor(s.viewport.w, s.cameraY, s.viewport.h, altM);
      if (m) {
        m.x = s.cameraX + m.x - s.viewport.w / 2;
        s.env.meteors.push(m);
      }
    }
    s.env.meteors.forEach((m) => {
      m.t += dt;
      m.alt -= m.vy * dt;
      m.x += m.vx * dt;
    });
    s.env.meteors = s.env.meteors.filter((m) => {
      if (m.t >= m.life || m.alt < s.cameraY - 200) return false;
      const d = Math.hypot(m.x - s.character.x, m.alt - s.character.alt);
      if (d < 22 && phase === 'playing' && (s.jump || s.fall || !s.character.landed)) {
        if (m.good) {
          s.score += 15;
          setScore(s.score);
          popScoreGain(15);
          setFloater({ text: '★ 流星', sub: '+15', color: '#f2d27a', key: now + Math.random() });
        } else if (s.skills.shield) {
          s.skills.shield = false;
          syncActiveSkillsHUD();
          sndSkill();
          setFloater({ text: '⛨ 挡下陨石', color: '#a7f3d0', key: now });
        } else {
          s.fall = { v: -60, fromAlt: s.character.alt, missionMiss: !!s.mission };
          s.jump = null;
          s.character.landed = false;
          setFloater({ text: '陨石！', sub: '坠落', color: '#fca5a5', key: now });
        }
        return false;
      }
      return true;
    });

    // 雷暴闪
    const storm = stormIntensity(altM);
    if (storm > 0 && Math.random() < 0.004 + storm * 0.01) {
      s.env.stormFlash = 0.55 + storm * 0.35;
    }
    if (s.env.stormFlash > 0) s.env.stormFlash = Math.max(0, s.env.stormFlash - dt * 2.2);

    // OWL 预览
    if (s.skills.owlReveal > 0) {
      const kinds = s.platforms.slice(s.standIdx + 1, s.standIdx + 6).map((p) => {
        const fog = inFogZone(altM) && s.skills.foxBlur <= 0;
        return displayKind(p, fog);
      });
      setOwlPreview(kinds);
    } else if (owlPreview.length) setOwlPreview([]);

    if (!s.jump && !s.fall) {
      s.character.blinkTimer -= dt;
      if (s.character.blinkTimer <= 0) {
        s.character.blink = 1;
        s.character.blinkTimer = rand(2.5, 4.5);
      }
    }
    if (s.character.blink > 0) {
      s.character.blink = Math.max(0, s.character.blink - dt * 6);
    }

    // 翅膀展收 + 姿态：起跳一拍扑开 → 上升半开借力 → 下落宽翼滑翔 → 着陆收翼
    let wingTarget = 0;
    let pose = 'idle';
    const wingBurstK = Math.max(0, Math.min(1, (s.character.wingBurst || 0) / 0.18));
    if (s.hold) {
      pose = 'charge';
      wingTarget = 0.06 + (s.smoothCharge ?? 0) * 0.1;
    } else if (s.jump) {
      if (s.jump.phase === 'rise') {
        pose = 'rise';
        const k = Math.min(1, s.jump.t / Math.max(0.001, s.jump.T));
        const liftOpen = 0.50 + Math.sin(k * Math.PI) * 0.10 + k * 0.12;
        const burstOpen = 0.76 + wingBurstK * 0.16;
        wingTarget = Math.max(liftOpen, wingBurstK > 0 ? burstOpen : 0);
      } else {
        pose = 'glide';
        const peak = s.jump.peakAlt ?? s.character.alt;
        const span = Math.max(48, peak - (s.jump.alt0 ?? s.character.alt));
        const fallen = Math.max(0, peak - s.character.alt);
        const fp = Math.min(1, fallen / span);
        wingTarget = 0.38 + fp * 0.62;
      }
    } else if (s.fall) {
      pose = 'tumble';
      wingTarget = 1;
    } else if (s.character.landingEase > 0) {
      pose = 'land';
      wingTarget = Math.max(0, 0.5 * (s.character.landingEase / 0.34));
    }
    s.character.pose = pose;
    if (s.character.wingBurst > 0) {
      s.character.wingBurst = Math.max(0, s.character.wingBurst - dt);
    }

    if (s.character.landingEase > 0) {
      s.character.landingEase = Math.max(0, s.character.landingEase - dt);
      if (s.character.squash > 0) s.character.squash = Math.max(0, s.character.squash - dt * 2.6);
    }

    // 落地吸附弹簧：landOffset 平滑归零 → 鸟滑入落点线，避免瞬移卡顿
    if (s.character.landOffset || s.character.landOffsetV) {
      const k = 210;    // 刚度
      const damp = 22;  // 阻尼（接近临界，回弹一次即稳）
      s.character.landOffsetV += (-k * s.character.landOffset - damp * s.character.landOffsetV) * dt;
      s.character.landOffset += s.character.landOffsetV * dt;
      if (Math.abs(s.character.landOffset) < 0.08 && Math.abs(s.character.landOffsetV) < 0.5) {
        s.character.landOffset = 0;
        s.character.landOffsetV = 0;
      }
    }

    const wingLerp = wingBurstK > 0 ? 30 : pose === 'glide' ? 16 : pose === 'land' ? 20 : pose === 'rise' ? 14 : 11;
    s.character.wingOpen += (wingTarget - s.character.wingOpen) * Math.min(1, dt * wingLerp);
    s.character.flapPhase += dt * (
      wingBurstK > 0 ? 34 : pose === 'glide' ? 24 : pose === 'rise' ? 16 : pose === 'tumble' ? 7 : 3
    );

    // 升空：先上升 → 再重力下落，途中可滑接任意对齐的云
    if (s.jump) {
      const sym = s.jump.sym;
      const fromIdx = s.jump.fromIdx;

      const handleMiss = () => {
        const next = s.platforms[fromIdx + 1];
        if (next) {
          const delta = next.cx - s.character.x;
          const direction = Math.abs(delta) < 12 ? '蓄力再多一点' : delta < 0 ? '向左多拉一点' : '向右多拉一点';
          setFloater({ text: '擦肩而过', sub: direction, color: '#fca5a5', key: now, big: true });
        }
        s.jump = null;
        if (s.skills.shield) {
          const safe = s.platforms[fromIdx];
          s.character.x = safe.cx;
          s.character.alt = safe.y;
          s.character.landed = true;
          s.character.rot = 0;
          s.character.landOffset = 0;
          s.character.landOffsetV = 0;
          s.standIdx = fromIdx;
          s.skills.shield = false;
          syncActiveSkillsHUD();
          sndSkill();
          haptic([20, 40, 20]);
          setFloater({ text: '⛨ SOS 复活', color: '#a7f3d0', key: now });
          s.letterBuf = '';
          setLetterBuf('');
          return;
        }
        s.character.landed = false;
        s.fall = {
          v: -120,
          fromAlt: s.character.alt,
          missionMiss: !!s.mission,
        };
      };

      const handleLand = (landing) => {
        const hitIdx = landing.index;
        const target = s.platforms[hitIdx];
        const quality = landingQuality(target, landing.landingX, PERFECT_TOL_PX);
        const isPerfect = quality === 'perfect';
        s.character.x = landing.landingX;

        if (!platformAcceptsSymbol(target, sym)) {
          const required = target.dual ? target.requiredSym : target.kind === 'dot' ? '.' : '-';
          s.combo = 0;
          setCombo(0);
          sndInvalid();
          haptic([24, 34, 24]);
          setFloater({
            text: '电码不匹配',
            sub: `这里需要 ${required === '.' ? '短按 · 点' : '长按 — 划'}`,
            color: '#fca5a5',
            key: now,
            big: true,
          });
          s.character.landed = false;
          s.jump = null;
          s.fall = { v: -70, fromAlt: s.character.alt, missionMiss: !!s.mission };
          return;
        }

        // 尖刺云：用「自然落点 X」判定是否扎到刺侧（在夹紧之前判断）
        if (target.spike && isImpaled(target, s.character.x)) {
          s.combo = 0;
          setCombo(0);
          sndInvalid();
          haptic([30, 40, 30]);
          setFloater({ text: '✖ 扎到尖刺', sub: '要落在安全的一侧', color: '#fca5a5', key: now, big: true });
          for (let i = 0; i < 10; i++) {
            s.sparks.push(...spawnSparks(s.character.x, target.y + 6, 6, { glow: 0.4 }));
          }
          s.shake = Math.max(s.shake, 6);
          s.character.landed = false;
          s.jump = null;
          s.fall = { v: -70, fromAlt: s.character.alt, missionMiss: !!s.mission };
          return;
        }

        // 落地吸附：把「当前高度→落点线」的残差交给弹簧缓冲，视觉上滑入而非瞬移
        const residual = s.character.alt - target.y;
        const impactV = s.jump?.fallV || 120;
        const impact = Math.max(0.5, Math.min(1.6, impactV / 150));
        freezeCloudOnLand(target, impact);
        s.jump = null;
        s.character.landed = true;
        // 不再硬吸到台子正中：保留自然落点 X，仅夹紧到台面安全区内（可偏离中心）
        {
          if (target.spike) {
            // 尖刺云：夹进安全侧范围（略内缩，避免贴着刺根）
            const { minX, maxX } = spikeSafeRange(target);
            const pad = 8;
            s.character.x = Math.max(minX + pad, Math.min(maxX - pad, s.character.x));
          } else {
            const half = (target.w || 60) * 0.34;
            s.character.x = Math.max(target.cx - half, Math.min(target.cx + half, s.character.x));
          }
        }
        s.standIdx = hitIdx;
        s.character.alt = target.y;
        // 视觉偏移：从残差起步 + 一点向下冲量 → 欠阻尼回弹出「落地一沉」
        s.character.landOffset = residual;
        s.character.landOffsetV = -6 * impact;
        s.character.landingEase = 0.34;
        s.character.squash = isPerfect ? 0.24 : 0.15;
        s.character.wingOpen = Math.max(s.character.wingOpen, 0.88);
        s.character.pose = 'land';
        s.character.rot = 0;
        const prevAlt = Math.round((s.platforms[fromIdx]?.y ?? s.character.alt) / 6);
        const nextAlt = Math.round(target.y / 6);
        setAltitude(nextAlt);
        popAltGain(prevAlt, nextAlt);

        const skipped = hitIdx - fromIdx - 1;

        /* ===== 任务模式 ===== */
        if (s.mission) {
          if (target.isBranch && !target.branchCorrect) {
            s.combo = 0;
            setCombo(0);
            missionRetry(now);
            return;
          }
          if (hitIdx !== s.mission.curIdx) {
            s.combo = 0;
            setCombo(0);
            missionRetry(now);
            return;
          }
          let gained;
          if (isPerfect) {
            s.combo += 1;
            gained = 6 + Math.min(s.combo - 1, 5) * 2;
            sndPerfect();
            haptic([8, 36, 12]);
            setFloater({
              text: s.combo >= 2 ? `PERFECT ×${s.combo}` : 'PERFECT',
              sub: `+${gained}`,
              color: '#fff5d8', key: now, big: true,
            });
            const heat = s.combo >= 8 ? '255,255,255' : s.combo >= 5 ? '255,245,216' : '242,210,122';
            s.sparks.push(...spawnSparks(s.character.x, target.y, target.hue, { glow: 0.7 }));
            s.sparks.push(...spawnSparks(s.character.x, target.y - 6, target.hue + 30, { glow: 0.5 }));
            s.sparks.push(...spawnDust(s.character.x, target.y, 1));
            s.rings.push(makeRing(s.character.x, target.y, { r1: 46 + Math.min(s.combo, 8) * 6, width: 3, color: heat, life: 0.5 }));
          } else {
            s.combo = 0;
            gained = quality === 'clean' ? 4 : 2;
            if (quality === 'clean') {
              sndLand();
              haptic(8);
              setFloater({ text: '稳稳落地', sub: `+${gained}`, color: '#f2d27a', key: now, big: true });
            } else {
              sndEdge();
              haptic([5, 18, 5]);
              setFloater({ text: '擦边抓住', sub: `+${gained}`, color: '#bae6fd', key: now, big: true });
            }
            s.sparks.push(...spawnFlightTrail(s.character.x, target.y + 4, 0.65));
            s.sparks.push(...spawnDust(s.character.x, target.y, 0.7));
            s.rings.push(makeRing(s.character.x, target.y, { r1: 32, width: 2, color: '226,222,236', life: 0.4 }));
          }
          s.score += gained;
          setScore(s.score);
          popScoreGain(gained);
          setCombo(s.combo);
          if (target.isGoal) { missionVictory(); return; }
          if (target.sym) {
            sndTick();
            if (target.isLetterEnd) {
              sndSeal();
              setFloater({
                text: `✉ ${target.letter}`,
                sub: prettyMorse(FULL_MORSE[target.letter] || ''),
                color: '#f2d27a', key: now + 1,
              });
              s.sparks.push(...spawnSparks(s.character.x, target.y, 45));
            }
          }
          s.mission.curIdx = target.isBranch && target.branchCorrect ? hitIdx + 2 : hitIdx + 1;
          syncMissionHUD();
          return;
        }

        /* ===== 无尽模式 ===== */
        if (target.waxSeal && !isPerfect) {
          s.combo = 0;
          setCombo(0);
          sndInvalid();
          setFloater({ text: '封蜡未闭合', sub: '需 PERFECT', color: '#fca5a5', key: now });
          s.character.landed = false;
          s.fall = { v: -90, fromAlt: s.character.alt, missionMiss: false };
          s.jump = null;
          return;
        }
        if (target.decoy) {
          s.letterBuf = '';
          setLetterBuf('');
          setFloater({ text: '干扰电码', sub: '缓冲已清空', color: '#fdba74', key: now });
        }
        if (target.listen && target.listenCode) {
          playMorseCode(target.listenCode);
          setFloater({ text: '听码云', sub: prettyMorse(target.listenCode), color: '#c4b5fd', key: now + 2 });
        }
        if (target.relay) {
          const ab = choice(ABBREV_CHALLENGES);
          setFloater({ text: '中继站', sub: `${ab.word} · ${ab.hint}`, color: '#bae6fd', key: now + 3 });
        }
        if (target.fragile) s.fragileTimer = 1.15;
        if (target.isSummit) { summitVictory(); return; }

        if (skipped > 0) {
          sndLand();
          const skipBonus = skipped * 4;
          s.score += skipBonus;
          setScore(s.score);
          popScoreGain(skipBonus);
          setFloater({
            text: '滑接',
            sub: skipped >= 2 ? `越过 ${skipped} 层 +${skipBonus}` : `高处落下 +${skipBonus}`,
            color: '#bae6fd', key: now, big: true,
          });
        }

        let baseGained = quality === 'clean' ? 4 : 2;
        if (isPerfect) {
          s.combo += 1;
          const bonus = Math.min(s.combo - 1, 6);
          baseGained = 6 + bonus * 2;
          sndPerfect();
          haptic([8, 36, 12]);
          if (skipped <= 0) {
            setFloater({
              text: s.combo >= 2 ? `PERFECT ×${s.combo}` : 'PERFECT',
              sub: `+${baseGained}`,
              color: '#fff5d8', key: now, big: true,
            });
          }
          const heat = s.combo >= 8 ? '255,255,255' : s.combo >= 5 ? '255,245,216' : '242,210,122';
          s.sparks.push(...spawnSparks(s.character.x, target.y, target.hue, { glow: 0.7, power: 1 + Math.min(s.combo, 8) * 0.05 }));
          s.sparks.push(...spawnSparks(s.character.x, target.y - 6, target.hue + 30, { glow: 0.5 }));
          s.sparks.push(...spawnDust(s.character.x, target.y, 1));
          s.rings.push(makeRing(s.character.x, target.y, { r1: 46 + Math.min(s.combo, 8) * 6, width: 3, color: heat, life: 0.5 }));
          // 连击里程碑：x5 / x10 满屏爆发 + 金光爆闪（保留一次轻微竖向脉冲，其余靠光效）
          if (s.combo === 5 || s.combo === 10 || (s.combo > 10 && s.combo % 5 === 0)) {
            s.flash = Math.min(1, 0.6 + s.combo * 0.02);
            s.shake = Math.max(s.shake, 6);
            s.rings.push(makeRing(s.character.x, target.y, { r0: 20, r1: 130, width: 2.5, color: '255,245,216', life: 0.7 }));
            for (let i = 0; i < 5; i++) {
              s.sparks.push(...spawnSparks(s.character.x + rand(-30, 30), target.y + rand(-20, 40), choice([24, 38, 50]), { glow: 0.8, big: true }));
            }
            sndSkill();
            haptic([10, 30, 10, 30, 16]);
            setFloater({ text: `连击 ×${s.combo}`, sub: '热流爆发', color: '#fff5d8', key: now + 1, big: true });
          }
        } else {
          s.combo = 0;
          if (skipped <= 0) {
            if (quality === 'clean') {
              sndLand();
              haptic(8);
              setFloater({ text: '稳稳落地', sub: `+${baseGained}`, color: '#f2d27a', key: now, big: true });
            } else {
              sndEdge();
              haptic([5, 18, 5]);
              setFloater({ text: '擦边抓住', sub: `+${baseGained}`, color: '#bae6fd', key: now, big: true });
            }
          }
          s.sparks.push(...spawnFlightTrail(s.character.x, target.y + 4, 0.65));
          s.sparks.push(...spawnDust(s.character.x, target.y, 0.7));
          s.rings.push(makeRing(s.character.x, target.y, { r1: 32, width: 2, color: '226,222,236', life: 0.4 }));
        }

        let gained = baseGained;
        if (s.skills.goldRemain > 0) {
          gained = baseGained * 2;
          s.skills.goldRemain -= 1;
          syncActiveSkillsHUD();
        }
        s.score += gained;
        setScore(s.score);
        popScoreGain(gained);
        setCombo(s.combo);
        onLandingSymbol(sym, isPerfect, now);

        while (s.platforms.length - hitIdx < 4) {
          const last = s.platforms[s.platforms.length - 1];
          // 用「正在生成的这朵云」的海拔算难度（而非小鸟位置）→ 云路与玩家走法无关，完全固定
          const altM = Math.round(last.y / 6);
          const diff = diffOfAlt(altM);   // 布局难度只看海拔 → 云路固定、与得分无关
          let forced = null;
          if (s.skills.skyNext) {
            forced = 'both';
            s.skills.skyNext = false;
            syncActiveSkillsHUD();
          }
          if (shouldSpawnSummit(altM, s.platforms)) {
            const summit = createSummitPlatform(last, s.viewport.w);
            s.platforms.push(summit);
            s.env.summitSpawned = true;
            break;
          }
          const np = nextPlatform(last, forced, s.kindHistory, diff, s.viewport.w, altM);
          if (s.skills.rainRemain > 0) {
            np.w = Math.min(CLOUD_W_MAX, s.viewport.w * 0.58);
            np.winH = Math.max(np.winH, 120);
            np.sizeKey = 'wide';
            s.skills.rainRemain -= 1;
            syncActiveSkillsHUD();
          }
          if (forced === 'both') { np.w = Math.min(CLOUD_W_MAX, s.viewport.w * 0.62); np.winH = 150; np.sizeKey = 'wide'; }
          s.platforms.push(np);
          s.kindHistory.push(np.kind);
          if (s.kindHistory.length > 6) s.kindHistory.shift();
        }
        if (hitIdx >= 2) {
          const cut = hitIdx - 1;
          s.platforms.splice(0, cut);
          s.standIdx -= cut;
        }
      };

      if (s.jump.phase === 'rise') {
        s.jump.t += dt;
        const { t, T, alt0, peakAlt, x0, x1 } = s.jump;
        const k = Math.min(1, t / T);
        const rise = 1 - Math.pow(1 - k, 3);
        s.character.alt = alt0 + (peakAlt - alt0) * rise;
        const windX = s.jump.windX || 0;
        // 水平进度：整段飞行连续 0→0.5（升空段），落点段接着 0.5→1.0，避免顶点处 X 回跳抖动
        const hp = 0.5 * k;
        const xEase = hp * hp * (3 - 2 * hp);
        const arc = Math.sin(k * Math.PI) * 4;
        s.character.x = (x0 ?? s.character.x) + ((x1 ?? x0 ?? s.character.x) - (x0 ?? s.character.x)) * xEase + arc + windX;
        s.character.rot += (0.04 * Math.sin(k * Math.PI) - s.character.rot) * Math.min(1, dt * 10);
        s.character.squash = -0.1 * Math.sin(k * Math.PI);
        if (Math.random() < 0.28) {
          s.sparks.push(...spawnFlightTrail(s.character.x, s.character.alt - 12, 0.32, comboTrailTint(s.combo)));
        }
        if (k >= 1) {
          s.jump.phase = 'fall';
          s.jump.fallV = 0;
          s.character.alt = peakAlt;
          s.character.squash = 0;
        }
      } else {
        // 下落：重力加速 + 张翼滑翔接台
        const previousAlt = s.character.alt;
        const previousX = s.character.x;
        s.jump.fallV += GRAVITY * dt * (s.skills.moonRemain > 0 ? 0.42 : 0.52);
        s.character.alt -= s.jump.fallV * dt;
        const windX = s.jump.windX || 0;
        const peak = s.jump.peakAlt ?? s.character.alt;
        const fallen = Math.max(0, peak - s.character.alt);
        const targetFallSpan = Math.max(24, peak - (s.jump.targetAlt ?? s.jump.alt0));
        const fp = Math.min(1, fallen / targetFallSpan);
        const { x0, x1 } = s.jump;
        // 落点段水平进度接续升空段：0.5→1.0，整段连续，无顶点回跳
        const hp = 0.5 + 0.5 * fp;
        const xEase = hp * hp * (3 - 2 * hp);
        s.character.x = (x0 ?? s.character.x) + ((x1 ?? x0 ?? s.character.x) - (x0 ?? s.character.x)) * xEase + windX * 0.4;
        const targetRot = fp < 0.2 ? 0.14 : fp > 0.55 ? -0.06 : 0.04;
        s.character.rot += (targetRot - s.character.rot) * Math.min(1, dt * 9);
        if (fp > 0.35 && Math.random() < 0.45) {
          s.sparks.push(...spawnFlightTrail(s.character.x, s.character.alt - 8, 0.28 + fp * 0.2, comboTrailTint(s.combo)));
        }

        const landing = findSweptLanding({
          platforms: s.platforms,
          fromIdx,
          previousAlt,
          currentAlt: s.character.alt,
          previousX,
          currentX: s.character.x,
        });
        if (landing) {
          handleLand(landing);
        } else if (s.character.alt < s.platforms[fromIdx].y - 42) {
          handleMiss();
        }
      }
    }

    // 坠落
    if (s.fall) {
      // 管理员无敌：任何坠落即刻救回当前站立的云，不会掉下去
      if (godRef.current) {
        const safe = s.platforms[s.standIdx] || s.platforms[0];
        if (safe) {
          s.fall = null;
          s.jump = null;
          s.character.x = safe.cx;
          s.character.alt = safe.y;
          s.character.landed = true;
          s.character.rot = 0;
          s.character.landOffset = 0;
          s.character.landOffsetV = 0;
        }
      } else {
      s.fall.v += GRAVITY * dt * 0.55;
      s.character.alt -= s.fall.v * dt;
      s.character.pose = 'tumble';
      s.character.wingOpen = Math.min(1, s.character.wingOpen + dt * 3);
      s.character.rot += dt * 3.5;
      if (Math.random() < 0.5) {
        s.sparks.push(...spawnFlightTrail(s.character.x, s.character.alt - 6, 0.4));
      }
      if (s.character.alt < s.fall.fromAlt - s.viewport.h * 0.62) {
        if (s.fall.missionMiss && s.mission) {
          missionRetry(now);
        } else {
          s.fall = null;
          gameOver();
        }
      }
      }
    }

    // 摄像机：跟随鸟的「视觉高度」(alt + landOffset)，而非骤降的 alt。
    // 落地帧 alt 瞬吸到落点线、landOffset 补上残差 → 视觉高度连续，镜头不跳；
    // 随后 landOffset 弹簧归零，鸟先稳稳落到台上，镜头再平稳跟过去。
    if (!s.fall) {
      const visualAlt = s.character.alt + (s.character.landOffset || 0);
      let camRate = 6;
      if (s.jump?.phase === 'rise') camRate = 3.4;
      else if (s.jump?.phase === 'fall') camRate = 8;
      else if (s.character.landingEase > 0) camRate = 5.5;  // 落地后镜头稍慢，让鸟先落定
      s.cameraY += (visualAlt - s.cameraY) * Math.min(1, dt * camRate);

      let camXRate = 5.2;
      if (s.jump?.phase === 'rise') camXRate = 3.6;
      else if (s.jump?.phase === 'fall') camXRate = 6.5;
      else if (s.character.landingEase > 0) camXRate = 5.5;
      s.cameraX += (s.character.x - s.cameraX) * Math.min(1, dt * camXRate);
    }

    if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 34);
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.4);

    // 粒子（世界坐标：alt 向上为正）
    s.sparks.forEach((p) => {
      p.t += dt;
      p.x += p.vx * dt;
      p.alt += p.va * dt;
      p.va -= 360 * dt;
      p.alpha = Math.max(0, 1 - p.t / p.life);
    });
    s.sparks = s.sparks.filter((p) => p.alpha > 0.02);

    // 冲击波光环
    if (s.rings && s.rings.length) {
      s.rings.forEach((rg) => { rg.t += dt; });
      s.rings = s.rings.filter((rg) => rg.t < rg.life);
    }
  };

  /** 世界海拔 → 屏幕 Y；矮视口自动上移角色，避免被底部操作坞遮挡。 */
  const altToScreenY = (s, alt) => (
    s.viewport.h * characterAnchorRatio(s.viewport.h) + (s.cameraY - alt)
  );

  const draw = () => {
    const canvas = canvasRef.current;
    const s = stateRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    const { w, h } = s.viewport;
    const anchorRatio = characterAnchorRatio(h);

    // 夜空：越高越深邃
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0a12');
    bg.addColorStop(0.5, '#12101a');
    bg.addColorStop(1, '#1d1a20');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 视差星层（两层，伪随机固定星位，随海拔/横向缓慢漂移）
    const xParallax = (s.cameraX - w * 0.5) * 0.14;
    const drawStars = (count, parallax, size, alphaBase) => {
      const offsetY = (s.cameraY * parallax) % h;
      ctx.fillStyle = '#fff5d8';
      for (let i = 0; i < count; i++) {
        let sx = ((i * 727) % 997) / 997 * w - xParallax * (parallax / 0.2);
        sx = ((sx % w) + w) % w;
        let sy = (((i * 331) % 991) / 991 * h + offsetY) % h;
        if (sy < 0) sy += h;
        const tw = 0.5 + 0.5 * Math.sin(Date.now() / 900 + i * 1.7);
        ctx.globalAlpha = alphaBase * (0.45 + 0.55 * tw);
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    drawStars(34, 0.12, 0.9, 0.5);
    drawStars(18, 0.28, 1.4, 0.7);

    // 顶部月光晕
    const glow = ctx.createRadialGradient(w * 0.5, -h * 0.1, 10, w * 0.5, -h * 0.1, h * 0.7);
    glow.addColorStop(0, 'rgba(242,210,122,0.12)');
    glow.addColorStop(1, 'rgba(242,210,122,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    let shakeX = 0, shakeY = 0;
    if (s.shake > 0) {
      // 阻尼正弦脉冲：竖向为主、横向减半，读作「一记冲击」而非满屏抖动噪声
      const t = Date.now() / 1000;
      const decay = Math.min(1, s.shake / 8);
      shakeY = Math.sin(t * 46) * s.shake * 0.6 * decay;
      shakeX = Math.sin(t * 38 + 1.3) * s.shake * 0.28 * decay;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // 海拔刻度线（每 500 世界单位一道，营造攀升感）
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    const stepW = 500;
    const topAlt = s.cameraY + h * anchorRatio;
    const botAlt = s.cameraY - h * (1 - anchorRatio);
    for (let a = Math.ceil(botAlt / stepW) * stepW; a <= topAlt; a += stepW) {
      if (a <= 0) continue;
      const sy = altToScreenY(s, a);
      ctx.strokeStyle = 'rgba(201,162,74,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(201,162,74,0.35)';
      ctx.fillText(`${Math.round(a / 10)}m`, 6, sy - 4);
    }

    // 横向世界：镜头跟随鸟，云与角色在宽天空中分布
    ctx.translate(w / 2 - s.cameraX, 0);

    // 云台（从下往上画）
    const expectIdx = s.mission ? s.mission.curIdx : (s.standIdx + 1);
    const altM = Math.round(s.cameraY / 6);
    const fog = inFogZone(altM);
    const worldMargin = 120;
    s.platforms.forEach((p, i) => {
      const sy = altToScreenY(s, p.y);
      if (sy < -80 || sy > h + 80) return;
      if (p.cx < s.cameraX - w / 2 - worldMargin || p.cx > s.cameraX + w / 2 + worldMargin) return;
      let kindOverride = null;
      if (s.skills.foxBlur > 0 && i > s.standIdx && !p.isSummit && !p.isGoal) {
        kindOverride = p.kind === 'dot' ? 'dash' : p.kind === 'dash' ? 'dot' : 'both';
      } else if (fog && !p.isSummit && !p.isGoal && !p.relay) {
        kindOverride = 'both';
      } else if (p.decoy && p.fakeKind) {
        kindOverride = p.fakeKind;
      }
      const isTarget = i === expectIdx && !p.broken && phase === 'playing';
      // 目标之后的云逐级变浅（淡出），让当前该落的目标最醒目、不误判越层
      let dim = 1;
      if (phase === 'playing' && i > expectIdx) {
        const beyond = i - expectIdx;                 // 1,2,3...
        dim = Math.max(0.26, 1 - beyond * 0.32);
      }
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * dim;
      drawCloud(ctx, p, sy, isTarget, kindOverride);
      ctx.globalAlpha = prevAlpha;
    });

    // 流星
    s.env.meteors.forEach((m) => {
      const sy = altToScreenY(s, m.alt);
      ctx.globalAlpha = 1 - m.t / m.life;
      ctx.fillStyle = m.good ? '#f2d27a' : '#fca5a5';
      ctx.beginPath();
      ctx.arc(m.x, sy, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // 冲击波光环（角色下方扩散）
    if (s.rings && s.rings.length) {
      s.rings.forEach((rg) => {
        const sy = altToScreenY(s, rg.alt);
        if (sy < -60 || sy > h + 60) return;
        const k = Math.min(1, rg.t / rg.life);
        const eased = rg.ease === 'out' ? 1 - Math.pow(1 - k, 3) : k;
        const r = rg.r0 + (rg.r1 - rg.r0) * eased;
        const a = (1 - k) * 0.85;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = `rgba(${rg.color},${a})`;
        ctx.lineWidth = rg.width * (1 - k * 0.6);
        ctx.shadowBlur = 12;
        ctx.shadowColor = `rgba(${rg.color},${a})`;
        ctx.beginPath();
        ctx.ellipse(rg.x, sy, r, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      ctx.globalAlpha = 1;
    }

    // 弹弓瞄准反馈：低调方向提示。不画线/箭头，只在「发射方向」一侧漾开一团柔光，
    // 光团朝发射方向偏移（往左滑=右侧亮），力度越大越亮越偏，配合猫头鹰倾身读出方向。
    if (s.hold && phase === 'playing') {
      const aim = Math.max(-1, Math.min(1, s.aimNorm ?? 0));
      const pull = Math.max(0, Math.min(1, s.aimPull ?? 0));
      if (Math.abs(aim) > 0.06) {
        const footY = altToScreenY(s, s.character.alt + (s.character.landOffset || 0));
        const bx = s.character.x;
        const dir = Math.sign(aim);              // 发射方向：aim 正=右（往左滑得到）
        const gx = bx + dir * (12 + pull * 20);  // 光团朝发射方向偏移
        const gy = footY - 24;
        const r = 12 + pull * 20;                // 力度越大光团越大
        const a = 0.12 + pull * 0.26;            // 始终很淡，低调
        ctx.save();
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        grad.addColorStop(0, `rgba(255,242,208,${a})`);
        grad.addColorStop(1, 'rgba(255,242,208,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 角色
    drawOwl(ctx, s.character, altToScreenY(s, s.character.alt + (s.character.landOffset || 0)), !!s.skills.shield);

    // 粒子（带辉光的用 shadowBlur 渲染，营造星火感）
    s.sparks.forEach((sp) => {
      const sy = altToScreenY(s, sp.alt);
      if (sy < -20 || sy > h + 20) return;
      ctx.globalAlpha = sp.alpha;
      ctx.fillStyle = sp.color;
      if (sp.glow) {
        ctx.shadowBlur = 8 * sp.glow;
        ctx.shadowColor = sp.color;
      }
      ctx.beginPath();
      ctx.arc(sp.x, sy, sp.r, 0, Math.PI * 2);
      ctx.fill();
      if (sp.glow) ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    ctx.restore();

    // 大事件金色高光爆闪（PERFECT 里程碑 / 技能 / 登顶）
    if (s.flash > 0) {
      const fg = ctx.createRadialGradient(w * 0.5, h * anchorRatio, 10, w * 0.5, h * anchorRatio, Math.max(w, h) * 0.75);
      fg.addColorStop(0, `rgba(255,240,200,${s.flash * 0.5})`);
      fg.addColorStop(0.5, `rgba(242,210,122,${s.flash * 0.22})`);
      fg.addColorStop(1, 'rgba(242,210,122,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, h);
    }

    // 雷暴闪白
    if (s.env.stormFlash > 0) {
      ctx.fillStyle = `rgba(220,230,255,${s.env.stormFlash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 迷雾蒙层
    if (fog && phase === 'playing') {
      const fogGrad = ctx.createLinearGradient(0, 0, 0, h);
      fogGrad.addColorStop(0, 'rgba(140,150,170,0)');
      fogGrad.addColorStop(0.5, 'rgba(100,110,130,0.12)');
      fogGrad.addColorStop(1, 'rgba(80,90,110,0.08)');
      ctx.fillStyle = fogGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // FEVER 氛围：连击分 3 档 —— 暖金(≥3) / 白热(≥5) / 极光(≥10)
    if (s.combo >= 3 && phase === 'playing') {
      const tier = s.combo >= 10 ? 2 : s.combo >= 5 ? 1 : 0;
      const feverRGB = tier === 2 ? '191,232,255' : tier === 1 ? '255,240,200' : '242,210,122';
      const pulseSpeed = tier === 2 ? 120 : tier === 1 ? 150 : 180;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / pulseSpeed);
      const baseA = tier === 2 ? 0.30 : tier === 1 ? 0.26 : 0.22;
      const alpha = Math.min(baseA, 0.08 + s.combo * 0.02) * (0.6 + 0.4 * pulse);
      const edge = Math.min(w, h) * (0.22 + tier * 0.05);
      const grads = [
        ctx.createLinearGradient(0, 0, edge, 0),
        ctx.createLinearGradient(w, 0, w - edge, 0),
        ctx.createLinearGradient(0, 0, 0, edge),
        ctx.createLinearGradient(0, h, 0, h - edge),
      ];
      grads.forEach((g, i) => {
        g.addColorStop(0, `rgba(${feverRGB},${alpha})`);
        g.addColorStop(1, `rgba(${feverRGB},0)`);
        ctx.fillStyle = g;
        if (i === 0)      ctx.fillRect(0, 0, edge, h);
        else if (i === 1) ctx.fillRect(w - edge, 0, edge, h);
        else if (i === 2) ctx.fillRect(0, 0, w, edge);
        else              ctx.fillRect(0, h - edge, w, edge);
      });
      // 高档位额外顶部铭牌
      if (tier >= 1) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.globalAlpha = 0.5 + 0.4 * pulse;
        ctx.fillStyle = `rgba(${feverRGB},0.95)`;
        ctx.fillText(tier === 2 ? '✦ AURORA FEVER ✦' : '✦ FEVER ✦', w / 2, 14 + edge * 0.3);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // 下一朵云在屏幕上方看不见时，顶部画向上箭头
    if (phase === 'playing' && !s.jump && !s.fall && s.character.landed) {
      const nextP = s.platforms[s.standIdx + 1];
      if (nextP) {
        const sy = altToScreenY(s, nextP.y);
        if (sy < 12) {
          const ax = Math.max(14, Math.min(w - 14, nextP.cx - s.cameraX + w / 2));
          ctx.save();
          ctx.globalAlpha = 0.78 + 0.22 * Math.sin(Date.now() / 260);
          ctx.fillStyle = '#FFD166';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ax,      10);
          ctx.lineTo(ax - 8,  22);
          ctx.lineTo(ax - 3,  22);
          ctx.lineTo(ax - 3,  32);
          ctx.lineTo(ax + 3,  32);
          ctx.lineTo(ax + 3,  22);
          ctx.lineTo(ax + 8,  22);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  };

  const restart = () => { startGame(gameMode, missionWord, { secret: secretLevel }); };

  const backToMenu = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    lastTRef.current = 0;
    setShowToolsMenu(false);
    setMissionResult(null);
    setPhase('idle');
    haptic(6);
  }, []);

  const handleSaveName = useCallback(() => {
    const name = nameInput.trim() || '无名信使';
    const entry = {
      name,
      score: pendingScoreRef.current,
      date: new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    };
    setBoard((prev) => {
      const next = [entry, ...prev]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_BOARD_ROWS);
      saveBoard(next);
      return next;
    });
    setNameSaved(true);
    haptic(12);
  }, [nameInput]);

  return (
    <div id="panel-play" role="tabpanel" className="relative flex flex-col h-full px-3 sm:px-5 fade-up-in min-h-0">
      <audio ref={bgmRef} preload="metadata" playsInline className="sr-only" aria-hidden="true" />
      {/* 顶部标题栏：左侧文案为主，右侧仅战绩 + 更多 */}
      <div className="mt-2 mb-3 flex items-start justify-between gap-2 flex-shrink-0">
        <div className="min-w-0 flex-1 pr-1">
          {phase !== 'idle' ? (
            <button type="button" onClick={backToMenu}
                    className="text-left btn-tactile inline-flex items-center gap-1.5 rounded-lg"
                    aria-label="返回选关">
              <SignalOwlIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
              <h2 className="text-[21px] font-semibold leading-snug tracking-wide" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                星途信使
              </h2>
              <Home className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--gold-300)', opacity: 0.75 }} />
            </button>
          ) : (
            <div className="inline-flex items-center gap-2">
              <SignalOwlIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
              <h2 className="text-[21px] font-semibold leading-snug tracking-wide" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                星途信使
              </h2>
            </div>
          )}
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            一封未寄出的信 · 乘云而上送往星空
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
          <button type="button" aria-label="战绩榜单"
                  onClick={() => { setShowToolsMenu(false); setShowBoard(true); }}
                  className="btn-tactile flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(201,162,74,0.10)', border: '1px solid rgba(201,162,74,0.25)' }}>
            <Trophy className="w-3.5 h-3.5" style={{ color: 'var(--gold-300)' }} />
            <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--gold-100)' }}>{best}</span>
          </button>
          <div className="relative">
            <button type="button" aria-label="更多" aria-expanded={showToolsMenu}
                    aria-haspopup="menu"
                    onClick={() => setShowToolsMenu((s) => !s)}
                    className="btn-icon btn-tactile w-9 h-9 flex-shrink-0 relative">
              <MoreHorizontal className="w-[18px] h-[18px]" />
              {bgmTrack ? (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                      style={{
                        background: bgmMuted ? 'rgba(255,255,255,0.35)' : 'var(--gold-300)',
                        boxShadow: !bgmMuted ? '0 0 6px var(--gold-300)' : 'none',
                      }} />
              ) : null}
            </button>
            {showToolsMenu ? (
              <>
                <div className="fixed inset-0 z-[58]" aria-hidden="true" onClick={() => setShowToolsMenu(false)} />
                <div role="menu" className="absolute right-0 top-full z-[59] mt-1.5 w-[min(228px,calc(100vw-2.5rem))] rounded-2xl py-1.5 shadow-xl pop-in"
                     style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', transformOrigin: 'top right' }}>
                  <button type="button" role="menuitem" onClick={() => { openBgmPicker(); }}
                          className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ color: 'var(--text)' }}>
                    <Music2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
                    <span>背景音乐</span>
                    {bgmTrack ? (
                      <span className="ml-auto text-[10px] truncate max-w-[72px]" style={{ color: 'var(--text-faint)' }}>
                        {(bgmTrack.word || '').slice(0, 8)}
                      </span>
                    ) : null}
                  </button>
                  {bgmTrack ? (
                    <button type="button" role="menuitem" onClick={() => { toggleBgmMute(); }}
                            className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                            style={{ color: 'var(--text)' }}>
                      {bgmMuted ? <VolumeX className="w-4 h-4 flex-shrink-0" /> : <Volume2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />}
                      <span>{bgmMuted ? '恢复背景音乐' : '静音'}</span>
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); onOpenLearn?.(); }}
                          className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ color: 'var(--text)' }}>
                    <GraduationCap className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
                    <span>字母教学</span>
                    <span className="ml-auto text-[10px]" style={{ color: 'var(--text-faint)' }}>学 · 练</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); setShowDict(true); }}
                          className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ color: 'var(--text)' }}>
                    <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
                    <span>摩斯字典</span>
                  </button>
                  <div className="my-1 mx-3 h-px" style={{ background: 'var(--border-subtle)' }} />
                  <button type="button" role="menuitemcheckbox" aria-checked={godMode}
                          onClick={() => { setGodMode((v) => !v); }}
                          className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ color: godMode ? '#a7f3d0' : 'var(--text)' }}>
                    <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: godMode ? '#a7f3d0' : 'var(--text-faint)' }} />
                    <span>管理员 · 无敌模式</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ color: godMode ? '#1a1a1a' : 'var(--text-faint)',
                                   background: godMode ? '#a7f3d0' : 'rgba(255,255,255,0.06)' }}>
                      {godMode ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); restart(); }}
                          className="menu-item w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ color: 'var(--text-muted)' }}>
                    <RotateCcw className="w-4 h-4 flex-shrink-0" />
                    <span>重新开始</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* 游戏面板 */}
      <div
        ref={wrapRef}
        role="application"
        tabIndex={0}
        aria-label="星途信使游戏区：按住蓄力，左右拖动瞄准，松手起跳。短按为点，长按为划。"
        className="flex-1 min-h-0 rounded-[28px] overflow-hidden relative select-none touch-none"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          cursor: phase === 'playing' ? 'pointer' : 'default',
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {/* 蓄力边缘光：短按档金光 / 长按档蓝光（松手前的即时反馈） */}
        {phase === 'playing' && charge > 0 ? (
          <div className="absolute inset-0 pointer-events-none rounded-[28px] transition-shadow duration-75"
               style={{
                 boxShadow: charge < SYMBOL_SPLIT
                   ? `inset 0 0 ${26 + charge * 90}px rgba(242,210,122,${0.10 + charge * 0.5})`
                   : `inset 0 0 ${40 + charge * 80}px rgba(125,211,252,${0.16 + charge * 0.38})`,
               }} />
        ) : null}

        {/* HUD — 顶栏状态条 + 底栏拼词坞，中间留给游戏画面 */}
        {phase === 'playing' ? (
        <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
          {godMode ? (
            <div className="absolute right-3 top-[52px] flex items-center gap-1 px-2 py-0.5 rounded-full"
                 style={{ background: 'rgba(167,243,208,0.16)', border: '1px solid rgba(167,243,208,0.5)' }}>
              <ShieldCheck className="w-3 h-3" style={{ color: '#a7f3d0' }} />
              <span className="text-[10px] font-semibold tracking-wide" style={{ color: '#a7f3d0' }}>无敌</span>
            </div>
          ) : null}
          <div
            className="px-3 pt-2 pb-2.5"
            style={{ background: 'linear-gradient(180deg, rgba(8,7,9,0.88) 0%, rgba(8,7,9,0.42) 72%, transparent 100%)' }}
          >
            <div className="flex items-end gap-2">
              <div className="shrink-0 w-[54px]">
                <span className="text-[9px] tracking-[0.2em] uppercase block leading-none mb-0.5" style={{ color: 'var(--text-faint)' }}>分</span>
                <div className="relative leading-none">
                  <span
                    ref={scoreNumRef}
                    className="text-[1.4rem] font-bold tabular-nums text-gold-grad"
                    style={{ fontFamily: 'var(--font-display)', willChange: 'transform' }}
                  >
                    {score}
                  </span>
                  <span ref={scorePlusRef} className="absolute -right-3.5 -top-0.5 text-xs font-bold font-mono"
                        style={{ color: '#a7f3d0', opacity: 0 }} />
                </div>
              </div>

              <div className="flex-1 min-w-0 pb-0.5">
                {gameMode === 'endless' ? (
                  <>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (altitude / SUMMIT_ALT_M) * 100)}%`,
                          background: 'linear-gradient(90deg, #7A5B1F, #F2D27A)',
                          boxShadow: '0 0 8px rgba(242,210,122,0.45)',
                        }}
                      />
                    </div>
                    <p className="text-[9px] text-center truncate mt-1 tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {zoneLabel}
                      <span className="mx-1 opacity-40">·</span>
                      天门 {altitude}/{SUMMIT_ALT_M}m
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-center tracking-[0.14em] pb-1" style={{ color: 'var(--text-muted)' }}>
                    寄信任务
                  </p>
                )}
              </div>

              <div className="shrink-0 w-[54px] text-right">
                <span className="text-[9px] tracking-[0.2em] uppercase block leading-none mb-0.5" style={{ color: 'var(--text-faint)' }}>高度</span>
                <div className="relative leading-none">
                  <span
                    ref={altNumRef}
                    className="text-lg font-semibold tabular-nums font-mono"
                    style={{ color: 'var(--gold-100)', willChange: 'transform' }}
                  >
                    {altitude}
                    <span className="text-[10px] font-normal ml-px" style={{ color: 'var(--text-muted)' }}>m</span>
                  </span>
                  <span ref={altPlusRef} className="absolute -left-4 top-0 text-xs font-mono font-bold" style={{ color: '#bae6fd', opacity: 0 }} />
                </div>
              </div>
            </div>
          </div>

          {(combo >= 2 || owlPreview.length > 0 || activeSkills.length > 0) ? (
            <div className="absolute top-[3.4rem] right-2 flex flex-col items-end gap-1 max-w-[46%]">
              {combo >= 2 ? (() => {
                const tier = combo >= 10 ? 2 : combo >= 5 ? 1 : combo >= 3 ? 0 : -1;
                const styleByTier = tier === 2
                  ? { bg: 'rgba(191,232,255,0.24)', bd: 'rgba(191,232,255,0.6)', fg: '#e0f2ff', label: 'AURORA' }
                  : tier === 1
                  ? { bg: 'rgba(255,240,200,0.24)', bd: 'rgba(255,240,200,0.6)', fg: '#fff5d8', label: 'FEVER' }
                  : tier === 0
                  ? { bg: 'rgba(242,210,122,0.22)', bd: 'rgba(242,210,122,0.5)', fg: 'var(--gold-100)', label: '连击' }
                  : { bg: 'rgba(242,210,122,0.16)', bd: 'rgba(242,210,122,0.4)', fg: 'var(--gold-100)', label: '' };
                return (
                  <div className={`px-2.5 py-1 rounded-full flex items-center gap-1 combo-glow ${tier >= 1 ? 'combo-fever' : ''}`}
                       style={{ background: styleByTier.bg, border: `1px solid ${styleByTier.bd}`, color: styleByTier.fg }}>
                    <Sparkles className="w-3.5 h-3.5" />
                    {styleByTier.label ? (
                      <span className="text-[8px] tracking-[0.15em] font-semibold opacity-90">{styleByTier.label}</span>
                    ) : null}
                    <span className="text-xs font-bold font-mono">×{combo}</span>
                  </div>
                );
              })() : null}
              {owlPreview.length > 0 ? (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                     style={{ background: 'rgba(196,181,253,0.12)', border: '1px solid rgba(196,181,253,0.28)' }}>
                  <span className="text-[8px]" style={{ color: '#c4b5fd' }}>OWL</span>
                  {owlPreview.map((k, i) => (
                    <span key={i} className="text-[10px] font-mono" style={{ color: 'var(--gold-100)' }}>
                      {k === 'dot' ? '·' : k === 'dash' ? '—' : '·—'}
                    </span>
                  ))}
                </div>
              ) : null}
              {activeSkills.map((sk) => (
                <div key={sk.kind} className="px-2 py-0.5 rounded-full flex items-center gap-1"
                     style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', backdropFilter:'blur(6px)' }}>
                  {sk.icon === 'shield' ? <ShieldCheck className="w-3 h-3" style={{color:'#a7f3d0'}}/> : null}
                  {sk.icon === 'crown'  ? <Crown        className="w-3 h-3" style={{color:'#a7f3d0'}}/> : null}
                  {sk.icon === 'wind'   ? <Wind         className="w-3 h-3" style={{color:'#bae6fd'}}/> : null}
                  {sk.icon === 'star'   ? <Star         className="w-3 h-3" style={{color:'#f2d27a'}}/> : null}
                  <span className="text-[9px] font-mono">{sk.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        ) : null}

        {/* 任务模式：底栏字母进度 */}
        {phase === 'playing' && gameMode === 'mission' && missionHUD ? (
          <div
            className={`absolute left-3 right-3 z-10 pointer-events-none transition-[bottom] duration-150 ${charge > 0 ? 'bottom-[3.4rem]' : 'bottom-3'}`}
          >
            <div
              className="rounded-2xl px-3 py-2.5"
              style={{ background:'rgba(8,7,9,0.78)', border:'1px solid rgba(201,162,74,0.2)', backdropFilter:'blur(10px)' }}
            >
              <p className="text-[10px] font-mono tracking-wide text-center truncate mb-2"
                 style={{ color: secretLevel ? '#c4b5fd' : 'var(--text-muted)' }}>
                {secretLevel ? '🔒 神秘电报 · 照着云跳，通关揭晓' : getMissionWordHint(missionWord)}
              </p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
                  {missionHUD.letters.map((L, i) => (
                    L.isSpace ? (
                      /* 词间停顿：显示一个间隔标记，通过后点亮 */
                      <div key={i} className="flex items-center shrink-0 px-1"
                           style={{ opacity: L.done ? 1 : L.active ? 1 : 0.4 }}>
                        <span className="text-[12px] leading-none"
                              style={{ color: L.done ? 'var(--gold-300)' : L.active ? '#a7f3d0' : 'var(--text-faint)' }}>
                          ·
                        </span>
                      </div>
                    ) : (
                    <div key={i} className="flex flex-col items-center px-1.5 py-0.5 rounded-lg shrink-0"
                         style={{
                           background: L.active ? 'rgba(242,210,122,0.14)' : 'transparent',
                           border: L.active ? '1px solid rgba(242,210,122,0.4)' : '1px solid transparent',
                           opacity: L.done ? 1 : L.active ? 1 : 0.5,
                         }}>
                      <span className="text-[13px] font-bold font-mono leading-none"
                            style={{ color: L.done ? 'var(--gold-300)' : L.active ? 'var(--gold-100)' : 'var(--text-faint)' }}>
                        {L.done ? '✓' : secretLevel ? '?' : L.letter}
                      </span>
                      <span className="text-[8px] font-mono tracking-[0.1em] mt-0.5 leading-none">
                        {L.code.split('').map((c, si) => (
                          <span key={si} style={{
                            color: L.done || si < L.symDone ? 'var(--gold-300)'
                                 : (L.active && si === L.symDone) ? '#a7f3d0' : 'rgba(255,255,255,0.22)',
                          }}>
                            {c === '.' ? '·' : '—'}
                          </span>
                        ))}
                      </span>
                    </div>
                    )
                  ))}
                </div>
                <div className="flex items-center gap-0.5 shrink-0 pl-2 border-l" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className="text-[11px] leading-none"
                          style={{ opacity: i < missionHUD.lives ? 1 : 0.18 }}>
                      ✉
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* 无尽模式：底栏摩斯拼词坞 */}
        {phase === 'playing' && gameMode !== 'mission' ? (
          (() => {
            const _lb = letterBuf;
            const _wb = wordBuf;
            const _hints = wordHints;
            const startIdx = Math.max(0, _wb.length - 8);
            const tiles = _wb.slice(startIdx).split('');

            // 下一跳会敲成什么：短按补「·」、长按补「—」
            const previewOf = (sym) => {
              const cand = _lb + sym;
              const letter = decodeLetter(cand);
              if (letter) return { kind: 'letter', letter };
              if (isValidPrefix(cand)) return { kind: 'more' };   // 摩斯还没敲完
              return { kind: 'bad' };                             // 会打断重来
            };
            const dotNext = previewOf('.');
            const dashNext = previewOf('-');

            const renderNext = (info) => {
              if (info.kind === 'letter') {
                return (
                  <span className="flex items-center justify-center rounded font-bold"
                        style={{ minWidth: 17, height: 17, padding: '0 3px', fontSize: 12, fontFamily: 'var(--font-display)',
                                 color: '#1a1a1a', background: 'linear-gradient(135deg,var(--gold-300),var(--gold-100))' }}>
                    {info.letter}
                  </span>
                );
              }
              if (info.kind === 'more') {
                return <span className="text-[11px] leading-none" style={{ color: 'var(--text-faint)' }}>…续</span>;
              }
              return <span className="text-[10px] leading-none" style={{ color: '#fca5a5' }}>重来</span>;
            };

            return (
          <div
            className={`absolute left-3 right-3 z-10 pointer-events-none transition-[bottom] duration-150 ${charge > 0 ? 'bottom-[3.4rem]' : 'bottom-3'}`}
          >
            <div
              className="rounded-2xl px-3 py-2.5"
              style={{ background:'rgba(8,7,9,0.82)', border:'1px solid rgba(201,162,74,0.22)', backdropFilter:'blur(10px)' }}
            >
              {/* 第 1 行：下一跳 短按/长按 会敲成的字母（实时预览） */}
              <div className="flex items-center gap-2 min-h-[26px]">
                <span className="text-[9px] tracking-[0.14em] shrink-0" style={{ color:'var(--text-faint)' }}>下一跳</span>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg shrink-0"
                     style={{ background:'rgba(242,210,122,0.08)', border:'1px solid rgba(242,210,122,0.22)' }}>
                  <span className="rounded-full flex-shrink-0" style={{ width:6, height:6, background:'var(--gold-100)', boxShadow:'0 0 6px rgba(242,210,122,0.8)' }} />
                  <span className="text-[10px]" style={{ color:'var(--text-muted)' }}>短按</span>
                  <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>→</span>
                  {renderNext(dotNext)}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg shrink-0"
                     style={{ background:'rgba(125,211,252,0.08)', border:'1px solid rgba(125,211,252,0.22)' }}>
                  <span className="rounded-full flex-shrink-0" style={{ width:14, height:6, background:'linear-gradient(90deg,#38bdf8,#7dd3fc)' }} />
                  <span className="text-[10px]" style={{ color:'var(--text-muted)' }}>长按</span>
                  <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>→</span>
                  {renderNext(dashNext)}
                </div>
                {_lb ? (
                  <div className="ml-auto flex items-center gap-1 shrink-0">
                    <span className="text-[9px]" style={{ color:'var(--text-faint)' }}>当前</span>
                    {_lb.split('').map((c, i) =>
                      c === '.' ? (
                        <span key={i} className="rounded-full flex-shrink-0" style={{ width:5, height:5, background:'var(--gold-100)' }} />
                      ) : (
                        <span key={i} className="rounded-full flex-shrink-0" style={{ width:11, height:5, background:'linear-gradient(90deg,var(--gold-600),var(--gold-100))' }} />
                      )
                    )}
                  </div>
                ) : null}
              </div>

              {/* 第 2 行：已拼字母 + 目标词进度 */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
                {tiles.length > 0 ? (
                  <>
                    <span className="text-[9px] tracking-[0.14em] shrink-0" style={{ color:'var(--text-faint)' }}>已拼</span>
                    <div className="flex items-center gap-1 shrink-0 overflow-x-auto no-scrollbar">
                      {tiles.map((ch, i) => {
                        const isLatest = startIdx + i === _wb.length - 1;
                        return (
                          <span key={i}
                                className="flex items-center justify-center rounded-md text-[11px] font-bold font-mono shrink-0"
                                style={{
                                  width: 20, height: 22,
                                  background: isLatest ? 'linear-gradient(135deg,var(--gold-300),var(--gold-100))' : 'rgba(242,210,122,0.1)',
                                  color: isLatest ? '#1a1a1a' : 'var(--gold-100)',
                                  border: isLatest ? 'none' : '1px solid rgba(201,162,74,0.2)',
                                }}>
                            {ch}
                          </span>
                        );
                      })}
                    </div>
                    {_hints.length > 0 ? (
                      <div className="ml-auto flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
                        <span className="text-[9px] shrink-0" style={{ color:'var(--text-faint)' }}>拼</span>
                        {_hints.slice(0, 2).map((h) => (
                          <span key={h.word}
                                className="text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"
                                style={{
                                  background: 'rgba(255,255,255,0.04)',
                                  border: `1px solid ${h.isSkill ? 'rgba(167,243,208,0.3)' : 'rgba(201,162,74,0.2)'}`,
                                }}>
                            <span>
                              <span style={{ color: h.isSkill ? '#a7f3d0' : 'var(--gold-100)' }}>{_wb}</span>
                              <span style={{ color: 'rgba(255,255,255,0.3)' }}>{h.tail}</span>
                            </span>
                            {h.isSkill ? <span style={{ color:'#a7f3d0' }}>★</span> : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[10px] tracking-[0.1em] truncate" style={{ color:'var(--text-faint)' }}>
                    落 PERFECT 才封箱成字母 · 连成词触发秘技（STAR★流星雨、GOLD★双倍…）
                  </span>
                )}
              </div>
            </div>
          </div>
            );
          })()
        ) : null}

        {/* 飘字 */}
        {floater ? (
          <div key={floater.key}
               className={`absolute left-1/2 -translate-x-1/2 pointer-events-none floater text-center ${floater.big ? 'floater-big' : ''}`}
               style={{ top: floater.big ? '32%' : '38%' }}>
            <div className={`font-bold tracking-wider drop-shadow-[0_0_24px_rgba(242,210,122,0.75)] ${floater.big ? 'text-4xl' : 'text-2xl font-semibold'}`}
                 style={{ color: floater.color || 'var(--gold-100)', fontFamily: 'var(--font-display)' }}>
              {floater.text}
            </div>
            {floater.sub ? (
              <div className={`mt-1 font-mono tracking-widest font-semibold ${floater.big ? 'text-base' : 'text-[11px] mt-0.5'}`}
                   style={{ color: floater.color || 'var(--text-muted)' }}>
                {floater.sub}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 技能横幅 */}
        {skillBanner ? (
          <div key={skillBanner.key} className="absolute left-1/2 top-[28%] -translate-x-1/2 pointer-events-none banner text-center">
            <div className="text-[10px] tracking-[0.4em] mb-1" style={{ color:'var(--text-muted)' }}>
              {SKILL_WORDS[skillBanner.word] ? '★ SKILL' : 'WORD'}
            </div>
            <div className="text-4xl font-bold tracking-[0.15em] drop-shadow-[0_0_24px_rgba(242,210,122,0.7)]"
                 style={{ color: skillBanner.color, fontFamily: 'var(--font-display)' }}>
              {skillBanner.word}
            </div>
            <div className="text-[12px] mt-1" style={{ color: skillBanner.color }}>{skillBanner.desc}</div>
          </div>
        ) : null}

        {/* 蓄力条 */}
        {phase === 'playing' && charge > 0 ? (() => {
          /* 任务模式：当前需要的符号（蓄错档位时给红色警示） */
          let expectedSym = null;
          if (gameMode === 'mission' && missionHUD) {
            const L = missionHUD.letters.find((l) => l.active);
            expectedSym = L ? (L.code[L.symDone] || null) : 'any';
          } else {
            const s = stateRef.current;
            const target = s?.platforms?.[s.standIdx + 1];
            expectedSym = target?.dual
              ? target.requiredSym
              : target?.kind === 'dot' ? '.' : target?.kind === 'dash' ? '-' : 'any';
          }
          const curSym = charge < SYMBOL_SPLIT ? '.' : '-';
          const wrongZone = expectedSym && expectedSym !== 'any' && expectedSym !== curSym;
          const { dotFill, dashFill } = chargeBarFills(charge);
          return (
            <div className="absolute bottom-3 left-6 right-6 pointer-events-none">
              <div
                className="relative h-2 rounded-full overflow-hidden flex"
                style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="relative h-full" style={{ width: '50%' }}>
                  <div
                    className="h-full rounded-l-full"
                    style={{
                      width: `${dotFill * 100}%`,
                      background: wrongZone && curSym === '.'
                        ? 'linear-gradient(90deg, #b45f5f 0%, #fca5a5 100%)'
                        : 'linear-gradient(90deg, #c9a24a 0%, #f2d27a 100%)',
                      boxShadow: dotFill > 0.02
                        ? (wrongZone && curSym === '.'
                          ? '0 0 10px rgba(252,165,165,0.65)'
                          : '0 0 10px rgba(242,210,122,0.65)')
                        : undefined,
                    }}
                  />
                </div>
                <div className="w-px flex-shrink-0 self-stretch" style={{ background:'rgba(255,255,255,0.45)' }} />
                <div className="relative h-full" style={{ width: '50%' }}>
                  <div
                    className="h-full rounded-r-full"
                    style={{
                      width: `${dashFill * 100}%`,
                      background: wrongZone && curSym === '-'
                        ? 'linear-gradient(90deg, #b45f5f 0%, #fca5a5 100%)'
                        : 'linear-gradient(90deg, #7dd3fc 0%, #38bdf8 100%)',
                      boxShadow: dashFill > 0.02
                        ? (wrongZone && curSym === '-'
                          ? '0 0 10px rgba(252,165,165,0.65)'
                          : '0 0 10px rgba(125,211,252,0.7)')
                        : undefined,
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between mt-1 text-[10px] font-mono" style={{ color:'var(--text-faint)' }}>
                <span style={{ color: expectedSym === '.' ? '#a7f3d0' : dotFill > 0.15 ? 'var(--gold-100)' : undefined }}>
                  · di{expectedSym === '.' ? ' ◄' : ''}
                </span>
                {expectedSym && expectedSym !== 'any' ? (
                  <span style={{ color: wrongZone ? '#fca5a5' : '#a7f3d0' }}>
                    {wrongZone ? '档位不对！' : '就是这个劲儿'}
                  </span>
                ) : null}
                <span style={{ color: expectedSym === '-' ? '#a7f3d0' : dashFill > 0.08 ? '#7dd3fc' : undefined }}>
                  {expectedSym === '-' ? '► ' : ''}— da
                </span>
              </div>
            </div>
          );
        })() : null}

        {/* idle / over 蒙层 */}
        {phase !== 'playing' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 py-5 min-h-0"
               style={{ background:'rgba(8,7,9,0.78)', backdropFilter:'blur(6px)' }}>
            {phase === 'idle' ? (
              <>
                {/* ── 抖音式极简首屏：3 秒看懂，1 键开玩 ── */}
                <div className="w-full max-w-[min(290px,calc(100vw-2rem))] flex flex-col items-center gap-4 max-h-[min(92vh,640px)] overflow-y-auto overscroll-contain">
                  <div className="flex flex-col items-center gap-1 w-full">
                    <div
                      className="w-14 h-14 mb-1 rounded-2xl flex items-center justify-center"
                      style={{
                        color: 'var(--gold-100)',
                        background: 'radial-gradient(circle at 50% 32%, rgba(242,210,122,0.22), rgba(201,162,74,0.06) 62%, transparent 70%)',
                        border: '1px solid rgba(201,162,74,0.28)',
                        boxShadow: '0 0 28px rgba(201,162,74,0.14)',
                      }}
                    >
                      <SignalOwlIcon className="w-10 h-10" strokeWidth={1.55} />
                    </div>
                    <h3 className="text-[26px] font-semibold tracking-wide text-center leading-none"
                        style={{ color:'var(--text)', fontFamily:'var(--font-display)' }}>
                      星途信使
                    </h3>
                    <p className="text-[11px] tracking-[0.1em] text-center" style={{ color:'var(--text-muted)' }}>
                      把心事敲成摩斯，一朵云一朵云送上星空
                    </p>
                  </div>

                  {/* 唯一规则：一行看懂 */}
                  <div className="w-full flex items-center justify-center gap-4 py-2.5 rounded-2xl"
                       style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,162,74,0.16)' }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[20px] leading-none font-mono font-bold" style={{ color:'#f2d27a' }}>·</span>
                      <span className="text-[11px]" style={{ color:'var(--text-muted)' }}>短按 小跳</span>
                    </div>
                    <div className="w-px h-7" style={{ background:'rgba(201,162,74,0.2)' }} />
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[20px] leading-none font-mono font-bold" style={{ color:'#7dd3fc' }}>—</span>
                      <span className="text-[11px]" style={{ color:'var(--text-muted)' }}>长按 冲天</span>
                    </div>
                    <div className="w-px h-7" style={{ background:'rgba(201,162,74,0.2)' }} />
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[13px] leading-none" style={{ color:'var(--gold-300)' }}>★</span>
                      <span className="text-[11px]" style={{ color:'var(--text-muted)' }}>踩云心暴击</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-center leading-relaxed px-1" style={{ color:'var(--text-faint)' }}>
                    无尽模式登顶 <b style={{ color:'var(--gold-100)' }}>{SUMMIT_ALT_M}m</b> 天门即通关 · 越高越难
                  </p>
                  <p className="text-[10px] text-center leading-relaxed px-1" style={{ color:'var(--text-faint)' }}>
                    碎云 / 双频 / 尖刺 / 迷雾 / 雷暴 / 星流 · 拼 FOX OWL MOON RAIN CODE
                  </p>

                  {/* 主按钮：立即开玩 */}
                  <button type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => startGame('endless')}
                          className="btn-tactile w-full py-3.5 rounded-full text-[15px] font-bold flex items-center justify-center gap-2 tracking-[0.15em] idle-cta"
                          style={{ background:'linear-gradient(135deg,#7A5B1F 0%,#C9A24A 50%,#F2D27A 100%)',
                                   color:'#1a1a1a', boxShadow:'0 6px 28px rgba(217,201,163,0.45)' }}>
                    <PlayIcon className="w-5 h-5" /> 开始送信
                  </button>

                  {/* 次入口：寄一封信（默认折叠） */}
                  {!showMissionPanel ? (
                    <button type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => setShowMissionPanel(true)}
                            className="btn-tactile px-5 py-2 rounded-full text-[12px] font-medium tracking-wide"
                            style={{ background:'rgba(201,162,74,0.10)', border:'1px solid rgba(201,162,74,0.28)',
                                     color:'var(--gold-100)' }}>
                      ✉ 寄一封信 · 自定义单词关卡
                    </button>
                  ) : (
                    <div className="w-full rounded-2xl px-3.5 py-3 flex flex-col gap-2 fade-up-in"
                         onPointerDown={(e) => e.stopPropagation()}
                         style={{ background:'rgba(201,162,74,0.07)', border:'1px solid rgba(201,162,74,0.22)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] tracking-[0.14em]" style={{ color:'var(--gold-100)' }}>
                          ✉ 寄一封信 · 出码
                        </p>
                        <button type="button" onClick={() => setShowMissionPanel(false)}
                                className="text-[11px] px-1.5" style={{ color:'var(--text-faint)' }}>
                          收起
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={MSG_MAX_LEN}
                          value={missionInput}
                          onChange={(e) => setMissionInput(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === 'Enter') startMission(); }}
                          placeholder="LOVE YOU / SEE U @ 8 / GO HOME!…"
                          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[13px] font-mono tracking-[0.12em] outline-none uppercase"
                          style={{ background:'rgba(8,7,9,0.5)', border:'1px solid rgba(201,162,74,0.28)',
                                   color:'var(--text)', caretColor:'var(--gold-300)' }}
                        />
                        <button type="button" onClick={startMission}
                                disabled={!normalizeMessage(missionInput)}
                                className="btn-tactile px-4 py-2 rounded-xl text-[12px] font-semibold flex-shrink-0 disabled:opacity-40"
                                style={{ background:'linear-gradient(135deg,#7A5B1F 0%,#C9A24A 50%,#F2D27A 100%)',
                                         color:'#1a1a1a' }}>
                          试玩
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['LOVE','HOME','SEE U @ 8','GO HOME!','I MISS U','MOON RIVER'].map((w) => (
                          <button key={w} type="button"
                                  onClick={() => setMissionInput(w)}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono tracking-widest btn-tactile"
                                  style={{ background: missionInput === w ? 'rgba(242,210,122,0.22)' : 'rgba(255,255,255,0.05)',
                                           border: missionInput === w ? '1px solid rgba(242,210,122,0.5)' : '1px solid rgba(255,255,255,0.10)',
                                           color: missionInput === w ? 'var(--gold-100)' : 'var(--text-muted)' }}>
                            {w}
                          </button>
                        ))}
                      </div>
                      {(() => {
                        // 预览：整句摩斯（空格显示为词间停顿 /），并提示是否超长
                        const norm = normalizeMessage(missionInput);
                        const tooLong = !norm && missionInput.trim().length > MSG_MAX_LEN;
                        if (tooLong) {
                          return (
                            <p className="text-[10px] tracking-[0.08em] text-left" style={{ color:'#f0a8a8' }}>
                              太长啦，精简到 {MSG_MAX_LEN} 个字符以内～
                            </p>
                          );
                        }
                        if (!norm) return null;
                        return (
                          <p className="text-[10px] font-mono tracking-[0.14em] text-left break-words" style={{ color:'var(--text-faint)' }}>
                            {norm.split('').map((ch) =>
                              ch === ' ' ? '/' : `${ch}=${prettyMorse(FULL_MORSE[ch] || '')}`).join('  ')}
                          </p>
                        );
                      })()}

                      {/* 生成的加密关卡码：发给朋友，TA 通关才知道你送的是什么 */}
                      {missionCode ? (
                        <div className="mt-1 rounded-xl px-3 py-2.5 flex flex-col gap-2 fade-up-in"
                             style={{ background:'rgba(124,58,237,0.10)', border:'1px solid rgba(167,139,250,0.32)' }}>
                          <p className="text-[10px] tracking-[0.14em] flex items-center justify-between gap-2" style={{ color:'#c4b5fd' }}>
                            <span>🔐 加密关卡码</span>
                            {/* 换布局：同词换一个 seed，关卡与关卡码同时刷新（仍可被对方复现） */}
                            <button type="button" onClick={rerollMission}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="btn-tactile px-2 py-0.5 rounded-full text-[9px] font-semibold flex items-center gap-1"
                                    style={{ background:'rgba(167,139,250,0.14)', border:'1px solid rgba(167,139,250,0.4)', color:'#ddd6fe' }}>
                              <RotateCcw className="w-3 h-3" /> 换个布局
                            </button>
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 min-w-0 text-[15px] font-mono font-bold tracking-[0.16em] break-all"
                                   style={{ color:'#ddd6fe', userSelect:'text', WebkitUserSelect:'text' }}>
                              {missionCode}
                            </code>
                            {__OFFLINE__ ? (
                              <span className="text-[10px] flex-shrink-0" style={{ color:'#c4b5fd' }}>长按代码复制</span>
                            ) : (
                              <button type="button" onClick={copyCode}
                                      className="btn-tactile px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 flex items-center gap-1"
                                      style={{ background: copied ? 'rgba(167,243,208,0.18)' : 'rgba(167,139,250,0.18)',
                                               border:`1px solid ${copied ? 'rgba(167,243,208,0.5)' : 'rgba(167,139,250,0.5)'}`,
                                               color: copied ? '#a7f3d0' : '#ddd6fe' }}>
                                {copied ? <><Check className="w-3.5 h-3.5" /> 已复制</> : '复制'}
                              </button>
                            )}
                          </div>
                          <p className="text-[9px] leading-relaxed" style={{ color:'var(--text-faint)' }}>
                            把这串码发给朋友 · TA「破译关卡码」进入 · 全程看不到原词，通关才揭晓 · 同词每次布局随机，码里已含布局
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* 破译关卡码：B 玩家输入好友的加密码进入保密关卡 */}
                  {!showCodePanel ? (
                    <button type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => { setShowCodePanel(true); setCodeError(''); }}
                            className="btn-tactile px-5 py-2 rounded-full text-[12px] font-medium tracking-wide"
                            style={{ background:'rgba(124,58,237,0.12)', border:'1px solid rgba(167,139,250,0.32)',
                                     color:'#c4b5fd' }}>
                      🔓 破译关卡码 · 输入好友的加密码
                    </button>
                  ) : (
                    <div className="w-full rounded-2xl px-3.5 py-3 flex flex-col gap-2 fade-up-in"
                         onPointerDown={(e) => e.stopPropagation()}
                         style={{ background:'rgba(124,58,237,0.08)', border:'1px solid rgba(167,139,250,0.28)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] tracking-[0.14em]" style={{ color:'#c4b5fd' }}>
                          🔓 破译关卡码
                        </p>
                        <button type="button" onClick={() => { setShowCodePanel(false); setCodeError(''); }}
                                className="text-[11px] px-1.5" style={{ color:'var(--text-faint)' }}>
                          收起
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={levelCodeInput}
                          onChange={(e) => { setLevelCodeInput(e.target.value.toUpperCase()); if (codeError) setCodeError(''); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') startCodeChallenge(); }}
                          placeholder="MC-XXXX-XX"
                          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[13px] font-mono tracking-[0.14em] outline-none uppercase"
                          style={{ background:'rgba(8,7,9,0.5)', border:`1px solid ${codeError ? 'rgba(248,113,113,0.5)' : 'rgba(167,139,250,0.3)'}`,
                                   color:'var(--text)', caretColor:'#c4b5fd' }}
                        />
                        <button type="button" onClick={startCodeChallenge}
                                disabled={levelCodeInput.trim().length < 4}
                                className="btn-tactile px-4 py-2 rounded-xl text-[12px] font-semibold flex-shrink-0 disabled:opacity-40"
                                style={{ background:'linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a78bfa 100%)',
                                         color:'#fff' }}>
                          进入
                        </button>
                      </div>
                      {codeError ? (
                        <p className="text-[10px]" style={{ color:'#fca5a5' }}>{codeError}</p>
                      ) : (
                        <p className="text-[9px] leading-relaxed" style={{ color:'var(--text-faint)' }}>
                          输入朋友分享的加密码 · 照着云跳通关，即可解密 TA 送的是什么
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] tracking-wide text-center" style={{ color:'var(--text-faint)' }}>
                    连跳拼出 STAR / FOX / OWL / SOS 等单词，触发隐藏秘技
                  </p>
                  {summitBest ? (
                    <p className="text-[10px] text-center" style={{ color:'#a7f3d0' }}>
                      已通关 · 最佳 {summitBest.score} 分 · {summitBest.alt}m
                    </p>
                  ) : null}
                </div>
              </>
            ) : phase === 'victory' && missionResult ? (
              <>
                {missionResult.summit ? (
                  <>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-3xl mb-1" aria-hidden="true">🌌</span>
                      <p className="text-[10px] tracking-[0.3em] uppercase mb-1" style={{ color:'var(--gold-400)' }}>
                        — Summit Reached —
                      </p>
                      <h3 className="text-2xl font-semibold" style={{ color:'var(--text)', fontFamily:'var(--font-display)' }}>
                        登顶天门
                      </h3>
                    </div>
                    <div className="w-full max-w-[260px] rounded-2xl px-4 py-3.5 text-center flex flex-col gap-2"
                         style={{ background:'rgba(201,162,74,0.08)', border:'1px solid rgba(201,162,74,0.28)' }}>
                      <p className="text-[13px]" style={{ color:'var(--text-muted)' }}>信使抵达星空之门</p>
                      <div className="flex justify-center gap-4 text-[11px]" style={{ color:'var(--text-muted)' }}>
                        <span>海拔 <b style={{ color:'var(--gold-100)' }}>{missionResult.alt}m</b></span>
                        <span>用时 <b style={{ color:'var(--gold-100)' }}>{missionResult.time}s</b></span>
                        <span>得分 <b style={{ color:'var(--gold-100)' }}>{missionResult.score}</b></span>
                      </div>
                      {summitBest ? (
                        <p className="text-[10px]" style={{ color:'#a7f3d0' }}>最佳纪录 {summitBest.score} 分</p>
                      ) : null}
                    </div>
                    <div className="flex gap-2.5" onPointerDown={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => startGame('endless')}
                              className="btn-tactile px-5 py-2.5 rounded-full text-[12px] font-semibold"
                              style={{ background:'linear-gradient(135deg,#7A5B1F 0%,#C9A24A 50%,#F2D27A 100%)', color:'#1a1a1a' }}>
                        再攀一次
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                {/* ── 任务完成：信已送达（按单词的主题庆祝） ── */}
                {celebration && (!missionResult.secret || revealed) ? (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                    {/* 主题氛围光晕 */}
                    <div className="absolute inset-0"
                         style={{ background:`radial-gradient(120% 80% at 50% 12%, ${celebration.theme.accent}22 0%, transparent 60%)` }} />
                    {celebration.bits.map((b) => (
                      <span key={b.id}
                            className={`absolute top-[-8%] ${celebration.theme.kind === 'float' ? 'celebrate-float' : celebration.theme.kind === 'rain' ? 'celebrate-rain' : 'celebrate-fall'}`}
                            style={{
                              left: `${b.left}%`,
                              animationDelay: `${b.delay}s`,
                              animationDuration: `${b.dur}s`,
                              '--drift': `${b.drift}px`,
                              opacity: b.opacity,
                            }}>
                        {celebration.theme.kind === 'rain' ? (
                          <span style={{ display:'block', width:2, height:16 + b.size, borderRadius:2,
                                         background:`linear-gradient(${celebration.theme.colors[0]}, transparent)` }} />
                        ) : celebration.theme.glyph ? (
                          <span style={{ fontSize:b.size, color:b.color, filter:`drop-shadow(0 0 6px ${b.color}aa)`,
                                         display:'block', transform:`rotate(${b.rot}deg)` }}>
                            {celebration.theme.glyph}
                          </span>
                        ) : (
                          <span style={{ display:'block', width:b.size, height:b.size, borderRadius:'50%',
                                         background:b.color, boxShadow:`0 0 8px ${b.color}` }} />
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}

                {missionResult.secret && !revealed ? (
                  /* ── 保密关卡：先只报「通关」，隐藏原词，等玩家点击解密 ── */
                  <>
                    <div className="relative flex flex-col items-center gap-0.5 z-[1]">
                      <span className="text-4xl mb-1 celebrate-pop" aria-hidden="true">🔒</span>
                      <p className="text-[10px] tracking-[0.3em] uppercase mb-1" style={{ color:'#c4b5fd' }}>
                        — Level Cleared —
                      </p>
                      <h3 className="text-2xl font-semibold" style={{ color:'var(--text)', fontFamily:'var(--font-display)' }}>
                        通关成功
                      </h3>
                      <p className="text-[11px] mt-0.5" style={{ color:'var(--text-muted)' }}>这封神秘电报，还没解开</p>
                    </div>

                    <div className="relative z-[1] w-full max-w-[260px] rounded-2xl px-4 py-3.5 text-center flex flex-col gap-2"
                         style={{ background:'rgba(20,20,24,0.72)', border:'1px solid rgba(167,139,250,0.35)',
                                  backdropFilter:'blur(10px)', boxShadow:'0 10px 40px rgba(124,58,237,0.22)' }}>
                      <p className="text-[10px] tracking-[0.14em]" style={{ color:'#c4b5fd' }}>🔐 加密关卡码</p>
                      <code className="text-[16px] font-mono font-bold tracking-[0.16em] break-all" style={{ color:'#ddd6fe' }}>
                        {encodeLevelCode(missionResult.word, missionResult.seed)}
                      </code>
                      <div className="flex justify-center gap-4 pt-1 text-[11px]" style={{ color:'var(--text-muted)' }}>
                        <span>用时 <b style={{ color:'var(--gold-100)' }}>{missionResult.time}s</b></span>
                        <span>重发 <b style={{ color: missionResult.retries === 0 ? '#a7f3d0' : 'var(--gold-100)' }}>{missionResult.retries}</b> 次</span>
                      </div>
                    </div>

                    <button type="button" onClick={() => { setRevealed(true); haptic([12, 30, 12]); sndVictory(); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="relative z-[1] btn-tactile w-full max-w-[260px] py-3 rounded-full text-[14px] font-bold flex items-center justify-center gap-2 tracking-[0.12em] idle-cta"
                            style={{ background:'linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a78bfa 100%)',
                                     color:'#fff', boxShadow:'0 6px 28px rgba(124,58,237,0.5)' }}>
                      <Sparkles className="w-4 h-4" /> 解密揭晓 · TA 送的是什么
                    </button>
                  </>
                ) : (
                <>
                <div className="relative flex flex-col items-center gap-0.5 z-[1]">
                  <span className="text-4xl mb-1 celebrate-pop" aria-hidden="true">
                    {celebration?.theme.glyph || '✉'}
                  </span>
                  <p className="text-[10px] tracking-[0.3em] uppercase mb-1" style={{ color: celebration?.theme.accent || 'var(--gold-400)' }}>
                    {missionResult.secret ? '— Decrypted —' : '— Letter Delivered —'}
                  </p>
                  <h3 className="text-2xl font-semibold" style={{ color:'var(--text)', fontFamily:'var(--font-display)' }}>
                    {celebration?.theme.title || '信已送达'}
                  </h3>
                  {celebration?.theme.sub ? (
                    <p className="text-[11px] mt-0.5" style={{ color:'var(--text-muted)' }}>{celebration.theme.sub}</p>
                  ) : null}
                </div>

                <div className={`relative z-[1] w-full max-w-[260px] rounded-2xl px-4 py-3.5 text-center flex flex-col gap-2 ${missionResult.secret ? 'reveal-pop' : ''}`}
                     style={{ background:'rgba(20,20,24,0.72)', border:`1px solid ${celebration?.theme.accent || 'rgba(201,162,74,0.28)'}55`,
                              backdropFilter:'blur(10px)', boxShadow:`0 10px 40px ${celebration?.theme.accent || '#000'}22` }}>
                  {missionResult.secret ? (
                    <p className="text-[10px] tracking-[0.14em]" style={{ color:'#c4b5fd' }}>TA 送给你的是</p>
                  ) : null}
                  <p className="text-[26px] font-bold tracking-[0.3em]"
                     style={{ fontFamily:'var(--font-display)',
                              background:`linear-gradient(135deg, ${celebration?.theme.colors?.[0] || '#C9A24A'}, ${celebration?.theme.accent || '#F2D27A'})`,
                              WebkitBackgroundClip:'text', backgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                    {missionResult.word}
                  </p>
                  <p className="text-[10px] font-mono tracking-[0.18em] break-words" style={{ color:'var(--gold-100)' }}>
                    {missionResult.word.split('').map((ch) => ch === ' ' ? '/' : prettyMorse(FULL_MORSE[ch] || '')).join(' ')}
                  </p>
                  <div className="flex justify-center gap-4 pt-1 text-[11px]" style={{ color:'var(--text-muted)' }}>
                    <span>用时 <b style={{ color:'var(--gold-100)' }}>{missionResult.time}s</b></span>
                    <span>重发 <b style={{ color: missionResult.retries === 0 ? '#a7f3d0' : 'var(--gold-100)' }}>{missionResult.retries}</b> 次</span>
                    <span>得分 <b style={{ color:'var(--gold-100)' }}>{missionResult.score}</b></span>
                  </div>
                  {missionResult.retries === 0 ? (
                    <p className="text-[10px] tracking-wide" style={{ color:'#a7f3d0' }}>✦ 完美电报 · 一次不差</p>
                  ) : null}
                </div>
                </>
                )}

                {/* 主操作：趁势进入无尽模式（保密关卡未揭晓前先不显示，避免剧透氛围） */}
                {(!missionResult.secret || revealed) ? (
                  <>
                <button type="button" onClick={() => startGame('endless')}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="relative z-[1] btn-tactile w-full max-w-[260px] py-3 rounded-full text-[14px] font-bold flex items-center justify-center gap-2 tracking-[0.12em] idle-cta"
                        style={{ background:'linear-gradient(135deg,#7A5B1F 0%,#C9A24A 50%,#F2D27A 100%)',
                                 color:'#1a1a1a', boxShadow:'0 6px 28px rgba(217,201,163,0.45)' }}>
                  <PlayIcon className="w-4 h-4" /> 乘云闯关 · 无尽模式
                </button>

                <div className="relative z-[1] flex gap-2.5" onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => startGame('mission', missionWord, { secret: missionResult.secret })}
                          className="btn-tactile px-5 py-2 rounded-full text-[12px] font-semibold"
                          style={{ background:'rgba(201,162,74,0.12)', border:'1px solid rgba(201,162,74,0.3)',
                                   color:'var(--gold-100)' }}>
                    {missionResult.secret ? '再玩一次' : '重寄这封'}
                  </button>
                  <button type="button" onClick={() => { setPhase('idle'); setMissionResult(null); }}
                          className="btn-tactile px-5 py-2 rounded-full text-[12px] font-semibold"
                          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.14)',
                                   color:'var(--text-muted)' }}>
                    {missionResult.secret ? '返回' : '再写一封'}
                  </button>
                </div>
                  </>
                ) : null}
                  </>
                )}
              </>
            ) : (
              <>
                {/* ── 结算：信息卡片 + 操作区 ── */}
                <div className="absolute inset-0" aria-hidden="true" onClick={restart} />

                <div className="relative flex flex-col items-center gap-4 pointer-events-none w-full max-w-[300px]">
                  {/* 成绩卡片 */}
                  <div
                    className="w-full rounded-3xl px-5 py-5 flex flex-col items-center gap-4"
                    style={{
                      background: 'rgba(20,20,24,0.88)',
                      border: '1px solid rgba(201,162,74,0.28)',
                      backdropFilter: 'blur(14px)',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                    }}
                  >
                    <div className="text-center">
                      <p className="text-[10px] tracking-[0.28em] uppercase mb-2" style={{ color: 'var(--gold-400)' }}>
                        {gameMode === 'mission' ? (secretLevel ? '神秘电报 · 未送达' : `「${missionWord}」寄失了`) : '送信中断'}
                      </p>
                      <p
                        className="text-[56px] font-bold leading-none text-gold-grad tabular-nums"
                        style={{ fontFamily: 'var(--font-display)', textShadow: '0 0 36px rgba(242,210,122,0.3)' }}
                      >
                        {score}
                      </p>
                      <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>本局得分</p>
                    </div>

                    <div className="w-full flex items-center justify-around text-center">
                      <div>
                        <p className="text-[10px] tracking-wider mb-0.5" style={{ color: 'var(--text-faint)' }}>飞行</p>
                        <p className="text-base font-semibold tabular-nums" style={{ color: 'var(--gold-100)' }}>{altitude}m</p>
                      </div>
                      <div className="w-px h-9" style={{ background: 'rgba(201,162,74,0.22)' }} aria-hidden="true" />
                      <div>
                        <p className="text-[10px] tracking-wider mb-0.5" style={{ color: 'var(--text-faint)' }}>最佳</p>
                        <p
                          className="text-base font-semibold tabular-nums"
                          style={{ color: score >= best && score > 0 ? 'var(--gold-100)' : 'var(--text-muted)' }}
                        >
                          {best}
                        </p>
                      </div>
                    </div>

                    {score >= best && score > 0 ? (
                      <p className="text-[11px] font-semibold tracking-[0.12em] text-gold-grad">✦ 新纪录</p>
                    ) : null}
                  </div>

                  {/* 操作区 */}
                  <div
                    className="flex flex-col items-center gap-3 pointer-events-auto w-full"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={restart}
                      className="btn-tactile w-full py-3.5 rounded-full text-[15px] font-bold flex items-center justify-center gap-2 tracking-[0.12em] idle-cta"
                      style={{
                        background: 'linear-gradient(135deg,#7A5B1F 0%,#C9A24A 50%,#F2D27A 100%)',
                        color: '#1a1a1a',
                        boxShadow: '0 6px 28px rgba(217,201,163,0.45)',
                      }}
                    >
                      <RotateCcw className="w-5 h-5 flex-shrink-0" />
                      <span>{gameMode === 'mission' ? (secretLevel ? '再挑战一次' : '重寄这封') : '再来一局'}</span>
                    </button>

                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {gameMode === 'mission' ? (
                        <button
                          type="button"
                          onClick={() => { setPhase('idle'); setMissionResult(null); }}
                          className="text-[12px] px-4 py-2 rounded-full btn-tactile whitespace-nowrap"
                          style={{
                            color: 'var(--gold-100)',
                            background: 'rgba(201,162,74,0.10)',
                            border: '1px solid rgba(201,162,74,0.25)',
                          }}
                        >
                          换一封信
                        </button>
                      ) : !nameSaved ? (
                        <button
                          type="button"
                          onClick={handleSaveName}
                          className="text-[12px] px-4 py-2 rounded-full btn-tactile flex items-center gap-1.5 whitespace-nowrap"
                          style={{
                            color: 'var(--gold-100)',
                            background: 'rgba(201,162,74,0.10)',
                            border: '1px solid rgba(201,162,74,0.25)',
                          }}
                        >
                          <Trophy className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>记入战绩榜</span>
                        </button>
                      ) : (
                        <p className="text-[11px] tracking-wide" style={{ color: 'var(--gold-300)' }}>✦ 已记录到战绩榜</p>
                      )}
                      <button
                        type="button"
                        onClick={backToMenu}
                        className="text-[12px] px-4 py-2 rounded-full btn-tactile flex items-center gap-1.5 whitespace-nowrap"
                        style={{
                          color: 'var(--text-muted)',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                        }}
                      >
                        <Home className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>返回选关</span>
                      </button>
                    </div>

                    {gameMode !== 'mission' && !nameSaved ? (
                      <input
                        type="text"
                        maxLength={10}
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
                        placeholder="留下信使名（选填）"
                        className="w-full rounded-xl px-3 py-2 text-[12px] text-center outline-none"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(201,162,74,0.22)',
                          color: 'var(--text)',
                          caretColor: 'var(--gold-300)',
                        }}
                      />
                    ) : null}

                    <p className="text-[10px] tracking-wide" style={{ color: 'var(--text-faint)' }}>
                      点击空白处快速重开
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        <style>{`
          .floater { animation: floaterRise 1.35s var(--ease-out) forwards; }
          .floater-big { animation: floaterRiseBig 1.55s var(--ease-out) forwards; }
          @keyframes floaterRise {
            0%   { opacity: 0; transform: translate(-50%, 8px) scale(0.88); }
            16%  { opacity: 1; transform: translate(-50%, -4px) scale(1.08); }
            100% { opacity: 0; transform: translate(-50%, -48px) scale(1); }
          }
          @keyframes floaterRiseBig {
            0%   { opacity: 0; transform: translate(-50%, 12px) scale(0.82); }
            14%  { opacity: 1; transform: translate(-50%, -6px) scale(1.14); }
            22%  { transform: translate(-50%, -2px) scale(1.08); }
            100% { opacity: 0; transform: translate(-50%, -72px) scale(1.02); }
          }
          .combo-glow { animation: comboPulse 1.2s ease-in-out infinite; }
          @keyframes comboPulse {
            0%, 100% { box-shadow: 0 0 8px rgba(242,210,122,0.35); }
            50%      { box-shadow: 0 0 18px rgba(242,210,122,0.65); }
          }
          .combo-fever { animation: comboPulse 1.2s ease-in-out infinite, comboFever 0.7s ease-in-out infinite; }
          @keyframes comboFever {
            0%, 100% { transform: scale(1); }
            50%      { transform: scale(1.08); }
          }
          .banner { animation: bannerPop 1.5s var(--ease-out) forwards; }
          @keyframes bannerPop {
            0%   { opacity: 0; transform: translate(-50%, 14px) scale(0.85); }
            14%  { opacity: 1; transform: translate(-50%, 0) scale(1.06); }
            22%  { transform: translate(-50%, 0) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -10px) scale(1); }
          }
          .idle-cta { animation: ctaBreath 2.2s ease-in-out infinite; }
          @keyframes ctaBreath {
            0%, 100% { transform: scale(1);     box-shadow: 0 6px 28px rgba(217,201,163,0.45); }
            50%      { transform: scale(1.035); box-shadow: 0 8px 36px rgba(217,201,163,0.65); }
          }
          .celebrate-pop { animation: celebratePop 0.6s var(--ease-out) both; }
          @keyframes celebratePop {
            0%   { opacity: 0; transform: scale(0.4) translateY(6px); }
            60%  { opacity: 1; transform: scale(1.25) translateY(-2px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
          .reveal-pop { animation: revealPop 0.7s var(--ease-out) both; }
          @keyframes revealPop {
            0%   { opacity: 0; transform: scale(0.72) rotateX(60deg); filter: blur(6px); }
            55%  { opacity: 1; transform: scale(1.06) rotateX(0deg); filter: blur(0); }
            100% { opacity: 1; transform: scale(1) rotateX(0deg); }
          }
          .celebrate-fall { animation-name: celebrateFall; animation-timing-function: linear; animation-iteration-count: infinite; will-change: transform, opacity; }
          @keyframes celebrateFall {
            0%   { transform: translateY(0) translateX(0) rotate(0deg); }
            100% { transform: translateY(118vh) translateX(var(--drift, 0px)) rotate(220deg); }
          }
          .celebrate-rain { animation-name: celebrateRain; animation-timing-function: cubic-bezier(0.4,0,0.9,1); animation-iteration-count: infinite; will-change: transform, opacity; }
          @keyframes celebrateRain {
            0%   { transform: translateY(0) translateX(0); }
            100% { transform: translateY(120vh) translateX(calc(var(--drift, 0px) * 0.4)); }
          }
          .celebrate-float { animation-name: celebrateFloat; animation-timing-function: ease-in-out; animation-iteration-count: infinite; will-change: transform, opacity; }
          @keyframes celebrateFloat {
            0%   { transform: translateY(110vh) translateX(0) scale(0.9); opacity: 0; }
            18%  { opacity: 1; }
            82%  { opacity: 1; }
            100% { transform: translateY(-10vh) translateX(var(--drift, 0px)) scale(1.05); opacity: 0; }
          }
        `}</style>
      </div>

      {/* 摩斯字典弹层 */}
      {showDict && (
        <div className="absolute inset-0 z-50 flex flex-col justify-start sheet-backdrop"
             style={{ background:'rgba(8,7,9,0.72)', backdropFilter:'blur(6px)' }}
             onClick={() => setShowDict(false)}>
          <div className="rounded-b-[28px] px-4 pt-4 pb-6 sheet-panel-top"
               style={{ background:'var(--surface)', border:'1px solid var(--border-subtle)',
                        borderTop:'none', maxHeight:'82%', overflowY:'auto' }}
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" style={{ color:'var(--gold-300)' }} />
                <span className="text-[13px] font-semibold tracking-[0.12em]"
                      style={{ color:'var(--gold-100)', fontFamily:'var(--font-display)' }}>
                  摩斯字典
                </span>
              </div>
              <button type="button" onClick={() => setShowDict(false)}
                      className="btn-icon w-8 h-8 flex items-center justify-center rounded-full"
                      style={{ color:'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] mb-3 tracking-wide" style={{ color:'var(--text-faint)' }}>
              · = 短按（di）　— = 长按（da）
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(MORSE_MAP).sort().map(([letter, code]) => (
                <div key={letter} className="flex flex-col items-center py-2 px-1 rounded-xl"
                     style={{ background:'var(--surface-sunken)', border:'1px solid var(--border-subtle)' }}>
                  <span className="text-[16px] font-bold leading-none"
                        style={{ color:'var(--text)', fontFamily:'var(--font-display)' }}>
                    {letter}
                  </span>
                  <span className="text-[11px] font-mono mt-1 tracking-widest" style={{ color:'var(--gold-100)' }}>
                    {code.replace(/\./g, '·').replace(/-/g, '—')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 背景音乐：从声印「我的收藏」选择 */}
      {showBgmPicker && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end sheet-backdrop"
             style={{ background: 'rgba(8,7,9,0.72)', backdropFilter: 'blur(6px)' }}
             onClick={() => setShowBgmPicker(false)}>
          <div className="rounded-t-[28px] px-4 pt-4 pb-6 flex flex-col max-h-[78%] sheet-panel"
               style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderBottom: 'none' }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Music2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
                <span className="text-[13px] font-semibold tracking-[0.12em] truncate"
                      style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)' }}>
                  背景音乐
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(201,162,74,0.12)', color: 'var(--text-muted)',
                               border: '1px solid rgba(201,162,74,0.22)' }}>
                  我的收藏
                </span>
              </div>
              <button type="button" onClick={() => setShowBgmPicker(false)}
                      className="btn-icon w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                      style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[10px] mb-3 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              与「声印」页收藏列表同步；选中的歌曲会在送信时循环播放（可点喇叭静音）。
            </p>

            <button type="button" onClick={clearBgmTrack}
                    className="w-full mb-2 py-2.5 rounded-xl text-[12px] font-medium btn-tactile row-tappable"
                    style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)',
                             color: 'var(--text-muted)' }}>
              不使用背景音乐
            </button>

            {bgmTrack ? (
              <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-xl"
                   style={{ background: 'rgba(201,162,74,0.08)', border: '1px solid rgba(201,162,74,0.22)' }}>
                <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                  正在播放：{(bgmTrack.word || '收藏').toUpperCase()}
                </span>
                <button type="button" onClick={toggleBgmMute}
                        className="btn-tactile px-2 py-1 rounded-lg flex items-center gap-1 text-[11px] flex-shrink-0"
                        style={{ color: 'var(--gold-100)' }}>
                  {bgmMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {bgmMuted ? '恢复' : '静音'}
                </button>
              </div>
            ) : null}

            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {savedBgmList.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    收藏里还没有歌曲
                  </p>
                  <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
                    先到「声印」生成或加载音乐，点 ♥ 收藏后再来这里选用
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 pb-2">
                  {[...savedBgmList].reverse().map((track, i) => {
                    const active = bgmTrack?.audio_url === track.audio_url;
                    const title = (track.word || '声印').toUpperCase();
                    return (
                      <button type="button" key={track.audio_url + i}
                              onClick={() => selectBgmTrack(track)}
                              className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl transition-colors row-tappable"
                              style={{
                                background: active
                                  ? 'linear-gradient(135deg,rgba(201,162,74,0.14) 0%,rgba(201,162,74,0.04) 100%)'
                                  : 'var(--surface-sunken)',
                                border: active
                                  ? '1px solid rgba(201,162,74,0.30)'
                                  : '1px solid var(--border-subtle)',
                              }}>
                        <span className="flex-1 min-w-0">
                          <span className="text-[13px] font-semibold block truncate"
                                style={{ color: active ? 'var(--gold-100)' : 'var(--text)',
                                         fontFamily: 'var(--font-display)' }}>
                            {title}
                          </span>
                          <span className="text-[10px] mt-0.5 block truncate" style={{ color: 'var(--text-faint)' }}>
                            {track.style_label || '声印'}
                          </span>
                        </span>
                        {active ? (
                          <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--gold-300)' }} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 战绩榜单弹层 */}
      {showBoard && (
        <div className="absolute inset-0 z-50 flex flex-col justify-start sheet-backdrop"
             style={{ background:'rgba(8,7,9,0.72)', backdropFilter:'blur(6px)' }}
             onClick={() => setShowBoard(false)}>
          <div className="rounded-b-[28px] px-4 pt-4 pb-6 sheet-panel-top"
               style={{ background:'var(--surface)', border:'1px solid var(--border-subtle)',
                        borderTop:'none', maxHeight:'80%', overflowY:'auto' }}
               onClick={e => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4" style={{ color:'var(--gold-300)' }} />
                <span className="text-[13px] font-semibold tracking-[0.12em]"
                      style={{ color:'var(--gold-100)', fontFamily:'var(--font-display)' }}>
                  战绩榜
                </span>
              </div>
              <div className="flex items-center gap-2">
                {board.length > 0 && (
                  <button type="button"
                          className="text-[10px] px-2 py-1 rounded-lg"
                          style={{ color:'var(--text-faint)', background:'rgba(255,255,255,0.04)',
                                   border:'1px solid var(--border-subtle)' }}
                          onClick={() => { setBoard([]); saveBoard([]); }}>
                    清空
                  </button>
                )}
                <button type="button" onClick={() => setShowBoard(false)}
                        className="btn-icon w-8 h-8 flex items-center justify-center rounded-full"
                        style={{ color:'var(--text-muted)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {board.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[12px]" style={{ color:'var(--text-faint)' }}>
                  还没有战绩，快去把信送远一点吧
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {board.map((entry, i) => (
                  <div key={i}
                       className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                       style={{
                         background: i === 0
                           ? 'linear-gradient(135deg,rgba(201,162,74,0.14) 0%,rgba(201,162,74,0.04) 100%)'
                           : 'var(--surface-sunken)',
                         border: i === 0
                           ? '1px solid rgba(201,162,74,0.30)'
                           : '1px solid var(--border-subtle)',
                       }}>
                    {/* 名次 */}
                    <span className="w-5 text-center text-[12px] font-bold flex-shrink-0"
                          style={{ color: i === 0 ? 'var(--gold-300)' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--text-faint)',
                                   fontFamily:'var(--font-display)' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    {/* 名字 */}
                    <span className="flex-1 text-[13px] font-medium truncate"
                          style={{ color:'var(--text)' }}>
                      {entry.name}
                    </span>
                    {/* 日期 */}
                    <span className="text-[10px] flex-shrink-0" style={{ color:'var(--text-faint)' }}>
                      {entry.date}
                    </span>
                    {/* 分数 */}
                    <span className="text-[15px] font-bold font-mono flex-shrink-0 w-10 text-right"
                          style={{ color: i === 0 ? 'var(--gold-300)' : 'var(--text)',
                                   fontFamily:'var(--font-display)' }}>
                      {entry.score}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* =========================================================
   绘制工具（竖屏登云版）
   drawCloud：sy 为云的落点线（窗口中心）在屏幕上的 Y。
   云的视觉厚度 = 落点窗口 winH（诚实反映容错范围）。
   颜色语言：金=· dot / 蓝=— dash / 白=both
   ========================================================= */
const CLOUD_COLORS = {
  dot:  { hue: 44,  edge: 'rgba(242,210,122,',  text: 'rgba(242,210,122,' },
  dash: { hue: 205, edge: 'rgba(125,211,252,',  text: 'rgba(186,230,253,' },
  both: { hue: 40,  edge: 'rgba(255,245,216,',  text: 'rgba(255,245,216,' },
};

const drawCloud = (ctx, p, sy, isNext = false, kindOverride = null) => {
  const cx = p.cx, w = p.w, winH = p.winH;
  const visH = Math.max(34, Math.min(winH * 0.6, 52));
  const top = sy - visH / 2;
  const drawKind = kindOverride || p.kind;
  const col = CLOUD_COLORS[drawKind] || CLOUD_COLORS.both;
  const isDash = drawKind === 'dash';
  const isBoth = drawKind === 'both';

  /* ---- 容错窗口雾带（半透明，收窄绘制，保持精致）---- */
  const mist = ctx.createLinearGradient(0, top, 0, top + visH);
  const mistCol = isDash ? '125,211,252' : isBoth ? '235,228,210' : '242,210,122';
  mist.addColorStop(0,   `rgba(${mistCol},0.02)`);
  mist.addColorStop(0.5, `rgba(${mistCol},0.10)`);
  mist.addColorStop(1,   `rgba(${mistCol},0.02)`);
  ctx.fillStyle = mist;
  roundRect(ctx, cx - w / 2, top, w, visH, 14); ctx.fill();

  /* ---- 云体：三团椭圆叠出蓬松感，中线即完美落点。dip=着陆下压回弹 ---- */
  const dip = p.dip || 0;
  const puffScale = p.sizeKey === 'narrow' || p.sizeKey === 'drift' ? 0.82
    : p.sizeKey === 'wide' ? 1.14 : 1;
  const puffColor = (a) => isDash
    ? `rgba(58, 76, 104, ${a})`
    : isBoth ? `rgba(78, 74, 66, ${a})` : `rgba(84, 70, 44, ${a})`;
  ctx.fillStyle = puffColor(0.92);
  ctx.beginPath();
  ctx.ellipse(cx,            sy + 3 + dip,       w * 0.34 * puffScale, CLOUD_CORE_H * 0.62, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - w * 0.26, sy + 5 + dip * 0.7, w * 0.20 * puffScale, CLOUD_CORE_H * 0.46, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.26, sy + 5 + dip * 0.7, w * 0.20 * puffScale, CLOUD_CORE_H * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  // 云顶高光（随中央下压）
  ctx.fillStyle = puffColor(0.5);
  ctx.beginPath();
  ctx.ellipse(cx, sy - 1 + dip * 0.5, w * 0.30, CLOUD_CORE_H * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ---- 尖刺云：致命侧长出一排冰锥/尖刺 + 安全侧发光引导 ---- */
  if (p.spike) {
    const half = w / 2;
    const spikeW = w * (p.spikeFrac || 0.3);
    const left = p.spikeSide === 'left';
    const dangerX0 = left ? cx - half : cx + half - spikeW;
    const dangerX1 = left ? cx - half + spikeW : cx + half;
    const safeX0 = left ? cx - half + spikeW : cx - half;
    const safeX1 = left ? cx + half : cx + half - spikeW;
    const baseY = sy + 2 + dip;                 // 刺根落在云面
    // 安全侧发光落带（绿色，告诉玩家往这边落）
    const safeGrad = ctx.createLinearGradient(safeX0, 0, safeX1, 0);
    safeGrad.addColorStop(0,   'rgba(167,243,208,0.04)');
    safeGrad.addColorStop(0.5, 'rgba(167,243,208,0.18)');
    safeGrad.addColorStop(1,   'rgba(167,243,208,0.04)');
    ctx.fillStyle = safeGrad;
    roundRect(ctx, safeX0, baseY - 7, Math.max(2, safeX1 - safeX0), 9, 4); ctx.fill();
    // 尖刺：一排三角，随难度更密更高
    const spikeCount = Math.max(3, Math.round(spikeW / 12));
    const step = spikeW / spikeCount;
    const spikeH = 15 + (p.spikeFrac || 0.3) * 12;
    const spikeGrad = ctx.createLinearGradient(0, baseY - spikeH, 0, baseY);
    spikeGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    spikeGrad.addColorStop(0.5, 'rgba(203,225,255,0.9)');
    spikeGrad.addColorStop(1, 'rgba(125,170,235,0.55)');
    for (let i = 0; i < spikeCount; i++) {
      const bx = dangerX0 + i * step;
      const jag = (i % 2 === 0 ? 0 : -2);       // 高低错落，更凶
      ctx.beginPath();
      ctx.moveTo(bx, baseY);
      ctx.lineTo(bx + step * 0.5, baseY - spikeH + jag);
      ctx.lineTo(bx + step, baseY);
      ctx.closePath();
      ctx.fillStyle = spikeGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,130,200,0.7)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      // 尖端寒光点
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(bx + step * 0.5, baseY - spikeH + jag + 1.5, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    // 危险侧警示描边
    ctx.strokeStyle = 'rgba(252,165,165,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(left ? dangerX1 : dangerX0, baseY - spikeH - 3);
    ctx.lineTo(left ? dangerX1 : dangerX0, baseY + 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ---- 完美落点线：云中央一道发光横线 ---- */
  const lineGrad = ctx.createLinearGradient(cx - w * 0.32, 0, cx + w * 0.32, 0);
  lineGrad.addColorStop(0,   `${col.edge}0)`);
  lineGrad.addColorStop(0.5, `${col.edge}0.85)`);
  lineGrad.addColorStop(1,   `${col.edge}0)`);
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.32, sy + 0.5);
  ctx.lineTo(cx + w * 0.32, sy + 0.5);
  ctx.stroke();

  /* ---- 符号徽标：云中央 ·/—/·— ---- */
  ctx.textAlign = 'center';
  if (p.dual && p.requiredSym) {
    ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(167,243,208,0.95)';
    ctx.fillText(p.requiredSym === '.' ? '· ?' : '— ?', cx, sy - CLOUD_CORE_H * 0.5 - 6);
  } else if (isBoth) {
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = `${col.text}0.85)`;
    ctx.fillText('· —', cx, sy - CLOUD_CORE_H * 0.5 - 6);
  } else {
    ctx.font = 'bold 15px JetBrains Mono, monospace';
    ctx.fillStyle = `${col.text}0.95)`;
    ctx.fillText(drawKind === 'dot' ? '·' : '—', cx, sy - CLOUD_CORE_H * 0.5 - 6);
  }

  /* ---- 特殊云角标 ---- */
  const tagY = top + 9;
  ctx.font = '7px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  if (p.fragile) { ctx.fillStyle = 'rgba(252,165,165,0.85)'; ctx.fillText('碎', cx - w / 2 + 4, tagY); }
  if (p.listen)  { ctx.fillStyle = 'rgba(196,181,253,0.9)'; ctx.fillText('听', cx - w / 2 + (p.fragile ? 14 : 4), tagY); }
  if (p.relay)   { ctx.fillStyle = 'rgba(186,230,253,0.9)'; ctx.fillText('中继', cx + w / 2 - 22, tagY); }
  if (p.waxSeal) { ctx.fillStyle = 'rgba(242,210,122,0.9)'; ctx.fillText('蜡', cx + w / 2 - 10, tagY); }
  if (p.spike)   { ctx.fillStyle = 'rgba(252,165,165,0.9)'; ctx.textAlign = 'center'; ctx.fillText('尖刺 · 落安全侧', cx, top - 4); ctx.textAlign = 'left'; }
  if (p.isSummit) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(242,210,122,0.95)';
    ctx.fillText('天门', cx, top - 4);
    const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 300);
    ctx.strokeStyle = `rgba(242,210,122,${pulse})`;
    ctx.lineWidth = 2;
    roundRect(ctx, cx - w / 2 - 4, top - 6, w + 8, visH + 12, 18); ctx.stroke();
    const beam = ctx.createLinearGradient(0, top - 100, 0, top);
    beam.addColorStop(0, 'rgba(242,210,122,0)');
    beam.addColorStop(1, `rgba(242,210,122,${0.12 + 0.06 * Math.sin(Date.now() / 400)})`);
    ctx.fillStyle = beam;
    ctx.fillRect(cx - w / 2, top - 100, w, 100);
  }
  if (p.isBranch) {
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.fillStyle = p.branchCorrect ? 'rgba(167,243,208,0.9)' : 'rgba(252,165,165,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(p.branchCorrect ? '正道' : '岔路', cx, top - 5);
  }
  if (isNext) {
    const pulse = 0.35 + 0.30 * Math.sin(Date.now() / 260);
    ctx.strokeStyle = `rgba(167,243,208,${pulse})`;
    ctx.lineWidth = 1.8;
    roundRect(ctx, cx - w / 2 - 3, top - 3, w + 6, visH + 6, 16); ctx.stroke();
    // 落点指示线（尖刺云指向安全侧中心，其余指向云中心）
    let guideX = cx;
    if (p.spike) {
      const { minX, maxX } = spikeSafeRange(p);
      guideX = (minX + maxX) / 2;
    }
    ctx.strokeStyle = `rgba(167,243,208,${0.15 + pulse * 0.25})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(guideX, sy + CLOUD_CORE_H * 0.5 + 4);
    ctx.lineTo(guideX, sy + CLOUD_CORE_H * 0.5 + 22);
    ctx.stroke();
    ctx.setLineDash([]);
    if (p.spike) {
      ctx.fillStyle = `rgba(167,243,208,${0.5 + pulse * 0.4})`;
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼ 安全', guideX, sy + CLOUD_CORE_H * 0.5 + 32);
    } else {
      const required = p.dual ? p.requiredSym : p.kind === 'dash' ? '-' : p.kind === 'dot' ? '.' : null;
      ctx.fillStyle = `rgba(167,243,208,${0.52 + pulse * 0.35})`;
      ctx.font = '600 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        required === '.' ? '短按 · 点' : required === '-' ? '长按 — 划' : '点 / 划均可',
        guideX,
        sy + CLOUD_CORE_H * 0.5 + 32,
      );
    }
  }

  /* ---- 漂移云：两侧方向箭头 ---- */
  if (p.moving) {
    const sway = Math.cos(p.phase || 0);
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.fillStyle = `rgba(186,230,253,${sway < 0 ? 0.9 : 0.25})`;
    ctx.fillText('‹', cx - w / 2 - 10, sy + 4);
    ctx.fillStyle = `rgba(186,230,253,${sway > 0 ? 0.9 : 0.25})`;
    ctx.fillText('›', cx + w / 2 + 10, sy + 4);
  }

  /* ---- 尺寸档角标（窄/宽） ---- */
  if (p.sizeKey === 'narrow' || p.sizeKey === 'wide') {
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.textAlign = p.sizeKey === 'narrow' ? 'left' : 'right';
    ctx.fillText(p.sizeKey === 'narrow' ? '窄' : '宽', p.sizeKey === 'narrow' ? cx - w / 2 + 4 : cx + w / 2 - 4, top + 10);
    ctx.textAlign = 'center';
  }

  /* ---- 字母封蜡云：字母徽章 ---- */
  if (p.isLetterEnd && p.letter) {
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255,245,216,0.95)';
    ctx.fillText(p.letter, cx + w * 0.38, sy - 10);
    ctx.strokeStyle = 'rgba(242,210,122,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(cx + w * 0.38, sy - 14, 9.5, 0, Math.PI * 2); ctx.stroke();
  }

  /* ---- 终点信箱云 ---- */
  if (p.isGoal) {
    const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 300);
    ctx.strokeStyle = `rgba(242,210,122,${pulse})`;
    ctx.lineWidth = 1.8;
    roundRect(ctx, cx - w / 2 - 2, top - 2, w + 4, visH + 4, 16); ctx.stroke();

    // 信箱立在云上
    const mTop = sy - CLOUD_CORE_H * 0.5 - 52;
    ctx.strokeStyle = '#7A5B1F';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, sy - 4); ctx.lineTo(cx, mTop + 22); ctx.stroke();
    const bw = 36, bh = 24;
    const bGrad = ctx.createLinearGradient(0, mTop, 0, mTop + bh);
    bGrad.addColorStop(0, '#C9A24A');
    bGrad.addColorStop(1, '#7A5B1F');
    ctx.fillStyle = bGrad;
    roundRect(ctx, cx - bw / 2, mTop, bw, bh, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,245,216,0.8)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, cx - bw / 2, mTop, bw, bh, 6); ctx.stroke();
    ctx.fillStyle = '#1a1410';
    roundRect(ctx, cx - 11, mTop + 9, 22, 4, 2); ctx.fill();
    // 小红旗
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath();
    ctx.moveTo(cx + bw / 2 - 2, mTop - 9);
    ctx.lineTo(cx + bw / 2 + 9, mTop - 5);
    ctx.lineTo(cx + bw / 2 - 2, mTop - 1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fda4af';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx + bw / 2 - 2, mTop - 10); ctx.lineTo(cx + bw / 2 - 2, mTop + 2); ctx.stroke();

    // 上升光柱
    const beam = ctx.createLinearGradient(0, top - 130, 0, top);
    beam.addColorStop(0, 'rgba(242,210,122,0)');
    beam.addColorStop(1, `rgba(242,210,122,${0.10 + 0.05 * Math.sin(Date.now() / 400)})`);
    ctx.fillStyle = beam;
    ctx.fillRect(cx - w / 2, top - 130, w, 130);
  }

  /* ---- 云下阴影雾 ---- */
  const under = ctx.createLinearGradient(0, sy + CLOUD_CORE_H * 0.5, 0, sy + CLOUD_CORE_H * 0.5 + 16);
  under.addColorStop(0, 'rgba(0,0,0,0.30)');
  under.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = under;
  ctx.fillRect(cx - w * 0.36, sy + CLOUD_CORE_H * 0.5, w * 0.72, 16);
};

/* ---------- 星途信使（猫头鹰造型）
   screenFootY：脚底所在屏幕 Y ---------- */
const drawOwl = (ctx, c, screenFootY, hasShield = false) => {
  const squash = c.squash;
  const cw = OWL_W * (1 + squash * 0.22);
  const ch = OWL_H * (1 - squash * 0.36);
  const wingOpen = Math.max(0, Math.min(1, c.wingOpen || 0));
  const pose = c.pose || 'idle';
  const isRise = pose === 'rise';
  const isGlide = pose === 'glide' || pose === 'tumble';
  const isLand = pose === 'land';
  const flap = Math.sin(c.flapPhase || 0);

  ctx.save();
  ctx.translate(c.x, screenFootY);
  ctx.rotate(c.rot);
  // 瞄准倾身：蓄力时身体朝发射方向（aimLean 正=右）轻微倾斜，
  // 让「往哪边发射」直接写在角色姿态上，不靠箭头/文字。阴影不受影响，故放在阴影之后再倾。
  const lean = Math.max(-1, Math.min(1, c.aimLean || 0));
  const shadowAlpha = c.landed && !isGlide ? 0.34 : isGlide ? 0.14 : 0.22;
  const shadowW = cw * 0.5 + Math.min(wingOpen * (isGlide ? 18 : 12), 14);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(0, 5, shadowW, isGlide ? 5 : 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 阴影画完后再倾身：绕脚底旋转一个小角度 + 顶部微移，形成「侧身蓄势」的体态
  if (Math.abs(lean) > 0.001) {
    ctx.rotate(lean * 0.09);         // 含蓄：最多约 5°
    ctx.transform(1, 0, lean * 0.07, 1, 0, 0);   // 顶部朝发射方向轻推
  }

  if (wingOpen > 0.04) {
    const ws  = cw * (isGlide ? 0.62 + wingOpen * 1.05 : isRise ? 0.62 + wingOpen * 1.12 : 0.50 + wingOpen * 0.94);
    const wy  = isGlide ? flap * 2.2 : isRise ? flap * (5 + wingOpen * 7) : flap * (4 + wingOpen * 9);

    const drawWing = (sign) => {
      const rootX = sign * cw * 0.38;
      const rootY = -ch * 0.56;
      const tipX  = sign * ws;
      const tipY  = isGlide
        ? -ch * (0.38 + wingOpen * 0.08) + wy
        : isRise
        ? -ch * (0.62 + wingOpen * 0.22) + wy
        : -ch * (0.50 + wingOpen * 0.14) + wy;

      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      if (isGlide) {
        ctx.bezierCurveTo(
          sign * ws * 0.42, -ch * (0.48 + wingOpen * 0.06) + wy,
          sign * ws * 0.92, -ch * (0.40 + wingOpen * 0.04) + wy,
          tipX, tipY,
        );
        ctx.bezierCurveTo(
          sign * ws * 0.78, -ch * 0.08 + wy * 0.3,
          sign * ws * 0.38, -ch * 0.04 + wy * 0.2,
          sign * cw * 0.40, -ch * 0.28,
        );
      } else if (isRise) {
        ctx.bezierCurveTo(
          sign * ws * 0.32, -ch * (0.82 + wingOpen * 0.14) + wy * 0.55,
          sign * ws * 0.80, -ch * (0.80 + wingOpen * 0.10) + wy,
          tipX, tipY,
        );
        ctx.bezierCurveTo(
          sign * ws * 0.86, -ch * (0.30 + wingOpen * 0.10) + wy * 0.35,
          sign * ws * 0.42, -ch * 0.08 + wy * 0.18,
          sign * cw * 0.40, -ch * 0.26,
        );
      } else {
        ctx.bezierCurveTo(
          sign * ws * 0.50, -ch * (0.72 + wingOpen * 0.17) + wy,
          sign * ws * 0.85, -ch * (0.60 + wingOpen * 0.11) + wy,
          tipX, tipY,
        );
        ctx.bezierCurveTo(
          sign * ws * 0.70, -ch * 0.12 + wy * 0.44,
          sign * ws * 0.34, -ch * 0.05 + wy * 0.24,
          sign * cw * 0.40, -ch * 0.26,
        );
      }
      ctx.closePath();

      // 渐变：翼根偏紫，翼尖更深
      const wGrad = ctx.createLinearGradient(rootX, rootY, tipX, tipY);
      wGrad.addColorStop(0,   'rgba(50, 42, 70, 0.97)');
      wGrad.addColorStop(0.5, 'rgba(32, 26, 50, 0.98)');
      wGrad.addColorStop(1,   'rgba(18, 14, 30, 0.96)');
      ctx.fillStyle = wGrad;
      ctx.fill();

      // ── 金色前缘描边（主羽骨） ──
      ctx.strokeStyle = `rgba(168, 124, 48, ${0.45 + wingOpen * 0.32})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      if (isGlide) {
        ctx.bezierCurveTo(
          sign * ws * 0.42, -ch * (0.48 + wingOpen * 0.06) + wy,
          sign * ws * 0.92, -ch * (0.40 + wingOpen * 0.04) + wy,
          tipX, tipY,
        );
      } else if (isRise) {
        ctx.bezierCurveTo(
          sign * ws * 0.32, -ch * (0.82 + wingOpen * 0.14) + wy * 0.55,
          sign * ws * 0.80, -ch * (0.80 + wingOpen * 0.10) + wy,
          tipX, tipY,
        );
      } else {
        ctx.bezierCurveTo(
          sign * ws * 0.50, -ch * (0.72 + wingOpen * 0.17) + wy,
          sign * ws * 0.85, -ch * (0.60 + wingOpen * 0.11) + wy,
          tipX, tipY,
        );
      }
      ctx.stroke();

      // ── 次羽纹（2条，增加层次感）──
      ctx.strokeStyle = `rgba(90, 72, 120, ${0.30 + wingOpen * 0.18})`;
      ctx.lineWidth = 0.9;
      for (let ri = 1; ri <= 2; ri++) {
        const t = ri / 3;
        ctx.beginPath();
        ctx.moveTo(sign * cw * (0.30 + t * 0.10), rootY * (0.72 + t * 0.22));
        ctx.quadraticCurveTo(
          sign * ws * (0.36 + t * 0.28), -ch * (0.50 + wingOpen * 0.07 * t) + wy * 0.55,
          sign * ws * (0.52 + t * 0.20), -ch * (0.20 + t * 0.05) + wy * 0.38,
        );
        ctx.stroke();
      }
    };

    drawWing(-1);  // 左翼
    drawWing(1);   // 右翼
  }
  // ──────────────────────────────────────────────────────────

  // 身体（蛋形）
  const bodyGrad = ctx.createLinearGradient(0, -ch, 0, 0);
  bodyGrad.addColorStop(0, '#3a3340');
  bodyGrad.addColorStop(1, '#0e0a14');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(0, -ch);
  ctx.bezierCurveTo(-cw * 0.55, -ch * 0.85, -cw * 0.55, -ch * 0.05, 0, 0);
  ctx.bezierCurveTo( cw * 0.55, -ch * 0.05,  cw * 0.55, -ch * 0.85, 0, -ch);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(242,210,122,0.32)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(242,210,122,0.10)';
  ctx.beginPath();
  ctx.ellipse(0, -ch * 0.32, cw * 0.30, ch * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // 角羽
  const tuftY = -ch + 1;
  const tuftX = cw * 0.30;
  ctx.fillStyle = '#1a1620';
  ctx.beginPath();
  ctx.moveTo(-tuftX, tuftY); ctx.lineTo(-tuftX - 4, tuftY - 9); ctx.lineTo(-tuftX + 4, tuftY - 1);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tuftX, tuftY);  ctx.lineTo(tuftX + 4, tuftY - 9);  ctx.lineTo(tuftX - 4, tuftY - 1);
  ctx.closePath(); ctx.fill();

  // 眼睛
  const eyeY  = -ch * 0.72;
  const eyeR  = Math.min(cw * 0.24, 6.8);
  const eyeOff = cw * 0.22;
  const blinkK = 1 - c.blink;
  ctx.fillStyle = '#fdf6e0';
  ctx.beginPath();
  ctx.ellipse(-eyeOff, eyeY, eyeR, eyeR * blinkK, 0, 0, Math.PI * 2);
  ctx.ellipse( eyeOff, eyeY, eyeR, eyeR * blinkK, 0, 0, Math.PI * 2);
  ctx.fill();
  if (blinkK > 0.2) {
    ctx.fillStyle = '#d4a747';
    ctx.beginPath();
    ctx.ellipse(-eyeOff, eyeY, eyeR * 0.7, eyeR * 0.7 * blinkK, 0, 0, Math.PI * 2);
    ctx.ellipse( eyeOff, eyeY, eyeR * 0.7, eyeR * 0.7 * blinkK, 0, 0, Math.PI * 2);
    ctx.fill();
    const pupilR = eyeR * (0.38 + squash * 0.32);
    ctx.fillStyle = '#0a0808';
    ctx.beginPath();
    ctx.ellipse(-eyeOff, eyeY, pupilR, pupilR * blinkK, 0, 0, Math.PI * 2);
    ctx.ellipse( eyeOff, eyeY, pupilR, pupilR * blinkK, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(-eyeOff + pupilR * 0.4, eyeY - pupilR * 0.4, 1.2, 0, Math.PI * 2);
    ctx.arc( eyeOff + pupilR * 0.4, eyeY - pupilR * 0.4, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 喙
  const beakY = -ch * 0.42;
  ctx.fillStyle = '#f2d27a';
  ctx.beginPath();
  ctx.moveTo(0, beakY + 4.5); ctx.lineTo(-3, beakY); ctx.lineTo(3, beakY);
  ctx.closePath(); ctx.fill();

  // 脚（着陆时张开抓云）
  ctx.strokeStyle = '#7A5B1F';
  ctx.lineWidth = 1.5;
  const footDrop = isLand ? 2.5 : 0;
  ctx.beginPath();
  ctx.moveTo(-3, 0); ctx.lineTo(-4, 3.5 + footDrop);
  ctx.moveTo( 3, 0); ctx.lineTo( 4, 3.5 + footDrop);
  ctx.stroke();
  if (isLand) {
    ctx.strokeStyle = 'rgba(122,91,31,0.5)';
    ctx.beginPath();
    ctx.moveTo(-5, 3.5 + footDrop); ctx.lineTo(-2, 3.5 + footDrop);
    ctx.moveTo( 5, 3.5 + footDrop); ctx.lineTo( 2, 3.5 + footDrop);
    ctx.stroke();
  }

  // 蓄力光晕
  if (squash > 0.05) {
    ctx.globalAlpha = squash * 0.7;
    const g = ctx.createRadialGradient(0, -ch, 1, 0, -ch, 18 + squash * 10);
    g.addColorStop(0, 'rgba(242,210,122,0.85)');
    g.addColorStop(1, 'rgba(242,210,122,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -ch, 18 + squash * 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // SOS 护盾
  if (hasShield) {
    ctx.strokeStyle = 'rgba(167,243,208,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.ellipse(0, -ch / 2, cw * 0.65, ch * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
};

const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
};

/* 粒子（世界坐标：x 屏幕横向 / alt 海拔，va 向上为正） */
const spawnSparks = (cx, alt, hue, opts = {}) => {
  const arr = [];
  const n = opts.count || 14;
  const power = opts.power || 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = (80 + Math.random() * 130) * power;
    arr.push({
      x: cx, alt: alt + 4,
      vx: Math.cos(a) * sp,
      va: Math.sin(a) * sp + 60,
      r: (1.6 + Math.random() * 1.8) * (opts.big ? 1.5 : 1),
      t: 0,
      life: (0.7 + Math.random() * 0.4) * (opts.big ? 1.25 : 1),
      alpha: 1,
      glow: opts.glow ?? 0.6,
      color: Math.random() < 0.5 ? `hsl(${hue + 10}, 85%, 72%)` : '#fff2c8',
    });
  }
  return arr;
};

/* 冲击波光环：落点/起跳/技能扩散圆环（世界坐标，锚定在 alt 上） */
const makeRing = (cx, alt, opts = {}) => ({
  x: cx,
  alt,
  t: 0,
  life: opts.life || 0.5,
  r0: opts.r0 || 6,
  r1: opts.r1 || 60,
  width: opts.width || 3,
  color: opts.color || '242,210,122',
  ease: opts.ease || 'out',
});

/* 落云尘扬：落地时向两侧喷出的低矮尘雾 */
const spawnDust = (cx, alt, power = 1) => {
  const arr = [];
  const n = Math.round(8 * power);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const sp = (40 + Math.random() * 90) * power;
    arr.push({
      x: cx + side * (4 + Math.random() * 6),
      alt: alt + Math.random() * 3,
      vx: side * sp,
      va: 18 + Math.random() * 34,      // 略微上扬后回落
      r: 1.4 + Math.random() * 2.4,
      t: 0,
      life: 0.34 + Math.random() * 0.3,
      alpha: 0.7,
      glow: 0,
      color: 'rgba(226,222,236,0.7)',
    });
  }
  return arr;
};

const spawnFlightTrail = (cx, alt, intensity = 1, tint = null) => {
  const arr = [];
  const count = Math.max(2, Math.min(12, Math.round(5 * intensity)));
  for (let i = 0; i < count; i++) {
    const sp = (32 + Math.random() * 70) * (0.75 + intensity * 0.3);
    arr.push({
      x: cx + (Math.random() - 0.5) * 12,
      alt: alt + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * sp * 0.7,
      va: -(20 + Math.random() * 50),   // 拖尾向下散
      r: 0.8 + Math.random() * 1.8,
      t: 0,
      life: 0.24 + Math.random() * 0.34,
      alpha: 0.92,
      glow: 0.5,
      color: tint || (Math.random() < 0.72 ? 'rgba(242,210,122,0.95)' : 'rgba(255,245,216,0.92)'),
    });
  }
  return arr;
};

/* 连击升温：combo 越高，拖尾从暖金渐变到白热 */
const comboTrailTint = (combo) => {
  if (combo >= 8) return Math.random() < 0.6 ? 'rgba(255,255,255,0.96)' : 'rgba(191,232,255,0.9)';
  if (combo >= 5) return Math.random() < 0.6 ? 'rgba(255,245,216,0.96)' : 'rgba(255,214,120,0.92)';
  return null;
};

export default JumpGame;
