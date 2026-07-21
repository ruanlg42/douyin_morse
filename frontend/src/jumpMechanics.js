/**
 * 星途信使 — 关卡机制与难度曲线
 * 海拔越高机制越多；无尽模式登顶 3000m 通关。
 */

export const SUMMIT_ALT_M = 3000;
export const ALT_PER_WORLD = 6;

export const ABBREV_CHALLENGES = [
  { word: 'SOS', bonus: 80, hint: '求救电文' },
  { word: 'CQ', bonus: 55, hint: '通用呼叫' },
  { word: 'OK', bonus: 45, hint: '确认回电' },
];

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- 关卡布局专用的「确定性」随机源 ----------
   无尽模式：同一 seed → 同一套云路（位置/间距/符号/变体），每局都一样、可背板。
   仅用于布局生成；粒子/流星/眨眼等表现效果仍用真随机（rand/choice），保持鲜活。 */
let _lvlState = 0x1a2b3c4d;
export const resetLevelRng = (seed = 0x1a2b3c4d) => { _lvlState = seed >>> 0; };
export const lrandom = () => {                       // mulberry32
  _lvlState = (_lvlState + 0x6D2B79F5) >>> 0;
  let t = _lvlState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const lrand = (a, b) => a + lrandom() * (b - a);
export const lchoice = (arr) => arr[Math.floor(lrandom() * arr.length)];

/** 综合难度：分数 + 海拔，越高越难 */
export const diffOfProgress = (score, altM) => {
  const dScore = Math.max(0, Math.min(1, score / 90));
  const dAlt = Math.max(0, Math.min(1, altM / SUMMIT_ALT_M));
  return Math.min(1, dScore * 0.4 + dAlt * 0.85);
};

/** 布局难度：只看海拔（与玩家分数无关）→ 保证无尽模式云路固定、可复现 */
export const diffOfAlt = (altM) => Math.min(1, Math.max(0, altM / SUMMIT_ALT_M) * 1.05);

export const tierOf = (altM) => {
  if (altM < 350) return 0;
  if (altM < 700) return 1;
  if (altM < 1050) return 2;
  if (altM < 1400) return 3;
  if (altM < 1800) return 4;
  if (altM < 2200) return 5;
  if (altM < 2600) return 6;
  return 7;
};

export const tierLabel = (t) => (
  ['晴空', '微风', '碎云', '双频', '迷雾', '雷暴', '星流', '天门'][t] || '晴空'
);

/** 为无尽模式生成的云附加变体（用确定性随机源 → 固定云路） */
export const applyPlatformVariant = (p, diff, altM, forceKind) => {
  const tier = tierOf(altM);
  if (p.isStart || p.isGoal || p.isSummit) return p;

  // 双频云：必须跳对 ·/—
  if (!forceKind && tier >= 2 && lrandom() < 0.08 + diff * 0.14) {
    p.dual = true;
    p.requiredSym = lrandom() < 0.5 ? '.' : '-';
    p.kind = 'both';
    p.w = Math.min(200, p.w * 1.12);
  }

  // 碎云：落台后 1.1s 消散
  if (!forceKind && tier >= 2 && lrandom() < 0.06 + diff * 0.12) {
    p.fragile = true;
    p.winH = Math.max(40, p.winH * 0.88);
  }

  // 干扰云：显示假符号，落台清空缓冲
  if (!forceKind && tier >= 3 && lrandom() < 0.05 + diff * 0.1) {
    p.decoy = true;
    p.fakeKind = p.kind === 'dot' ? 'dash' : p.kind === 'dash' ? 'dot' : lchoice(['dot', 'dash']);
  }

  // 中继站：超宽 + 提示缩写
  if (!forceKind && tier >= 1 && lrandom() < 0.04 + diff * 0.06) {
    p.relay = true;
    p.w = Math.min(200, Math.max(p.w, 150));
    p.winH = Math.min(130, p.winH * 1.15);
    p.kind = 'both';
  }

  // 听码云：落台播放摩斯
  if (!forceKind && tier >= 4 && lrandom() < 0.05 + diff * 0.08) {
    p.listen = true;
    p.listenCode = lchoice(['.-', '-...', '...', '--', '-.-']);
  }

  // 封蜡云（无尽彩蛋）：需 PERFECT
  if (!forceKind && tier >= 3 && lrandom() < 0.03 + diff * 0.05) {
    p.waxSeal = true;
    p.w = Math.min(180, p.w * 1.05);
  }

  // 漂移 + 侧风区叠加
  if (tier >= 1 && p.moving) {
    p.windZone = true;
  }

  // 尖刺云：一侧长满尖刺，必须落在安全的另一侧；占比随海拔慢慢变大。
  // 不与其它特殊云/漂移云叠加，保证「看准一侧落下」的判断是干净、可预期的。
  if (!forceKind && tier >= 2 && !p.moving
      && !p.dual && !p.fragile && !p.decoy && !p.relay && !p.listen && !p.waxSeal
      && lrandom() < 0.06 + diff * 0.20) {
    p.spike = true;
    p.spikeSide = lrandom() < 0.5 ? 'left' : 'right';
    p.spikeFrac = Math.min(0.62, 0.28 + diff * 0.34);   // 尖刺占云宽比例：约 0.28 → 0.62
    p.w = Math.min(190, Math.max(p.w, p.w * 1.22));      // 略加宽，安全侧不至于太窄
    p.kind = 'both';                                     // 长短皆可，让玩家专注瞄准落点
  }

  return p;
};

export const shouldSpawnSummit = (altM, platforms) => (
  altM >= SUMMIT_ALT_M * 0.94 && !platforms.some((p) => p.isSummit)
);

export const createSummitPlatform = (prev, vw) => ({
  y: prev.y + lrand(175, 210),
  cx: vw / 2,
  w: Math.min(200, Math.max(150, vw * 0.48)),
  winH: 138,
  kind: 'both',
  hue: 42,
  sizeKey: 'wide',
  isSummit: true,
  relay: true,
});

/** 环境：侧风强度（随海拔） */
export const windStrength = (altM) => {
  const t = tierOf(altM);
  if (t < 1) return 0;
  return Math.min(42, 8 + t * 5);
};

/** 是否处于迷雾层（隐藏云符号） */
export const inFogZone = (altM) => tierOf(altM) >= 3;

/** 雷暴闪烁 */
export const stormIntensity = (altM) => {
  const t = tierOf(altM);
  if (t < 4) return 0;
  return Math.min(1, 0.15 + (t - 4) * 0.22);
};

/** 生成流星/陨石 */
export const spawnMeteor = (vw, cameraY, viewH, altM) => {
  if (tierOf(altM) < 4) return null;
  const good = Math.random() < 0.62;
  return {
    x: rand(24, vw - 24),
    alt: cameraY + rand(viewH * 0.1, viewH * 0.85),
    vy: rand(280, 420),
    vx: rand(-30, 30),
    good,
    r: good ? rand(3, 5) : rand(4, 7),
    life: rand(1.8, 2.6),
    t: 0,
  };
};

/** 任务模式：中点插入分叉云（左正确 / 右干扰） */
export const injectMissionBranch = (platforms, word, vw) => {
  if (word.length < 4) return platforms;
  const midLetter = Math.floor(word.length / 2);
  let branchAt = -1;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    // 只在「真实符号云」的字母首符处分叉：跳过空格停顿云与无 sym 的云
    if (p.letterIdx === midLetter && p.symIdx === 0 && p.sym && !p.isSpace) { branchAt = i; break; }
  }
  if (branchAt < 1) return platforms;

  const correct = { ...platforms[branchAt] };
  const forkY = correct.y;
  const baseCx = correct.cx;
  const wrongSym = correct.sym === '.' ? '-' : '.';
  const left = {
    ...correct,
    y: forkY,
    cx: baseCx - 58,
    branch: 'left',
    isBranch: true,
    branchCorrect: true,
    w: Math.min(155, correct.w),
  };
  const right = {
    ...correct,
    y: forkY,
    cx: baseCx + 58,
    w: Math.min(145, correct.w * 0.9),
    winH: correct.winH * 0.88,
    kind: wrongSym === '.' ? 'dot' : 'dash',
    sym: wrongSym,
    isLetterEnd: false,
    branch: 'right',
    isBranch: true,
    branchCorrect: false,
    hue: 18,
    decoy: true,
    fakeKind: correct.sym === '.' ? 'dash' : 'dot',
  };

  const out = [...platforms];
  out.splice(branchAt, 1, left, right);
  return out;
};

export const displayKind = (p, fog) => {
  if (p.decoy && p.fakeKind) return p.fakeKind;
  if (fog && !p.isGoal && !p.isSummit && !p.relay) return 'both';
  return p.kind;
};

/* ---------- 尖刺云几何（落点判定与渲染共用） ----------
   云横向范围 [cx - w/2, cx + w/2]。带刺侧占 spikeFrac 的宽度是致命区，
   另一侧是安全落区。返回安全区的 [minX, maxX]（世界横坐标）。 */
export const spikeSafeRange = (p) => {
  const half = (p.w || 60) / 2;
  const spikeW = (p.w || 60) * (p.spikeFrac || 0);
  if (p.spikeSide === 'left') {
    // 刺在左：安全区 = 云右侧
    return { minX: p.cx - half + spikeW, maxX: p.cx + half };
  }
  // 刺在右：安全区 = 云左侧
  return { minX: p.cx - half, maxX: p.cx + half - spikeW };
};

/** 落点 X 是否落进了尖刺致命区（带一点内缩容差，避免边界误伤） */
export const isImpaled = (p, x) => {
  if (!p.spike) return false;
  const { minX, maxX } = spikeSafeRange(p);
  const pad = 3;                       // 安全区内缩，边界略宽容
  return x < minX - pad || x > maxX + pad;
};
