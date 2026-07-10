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
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 综合难度：分数 + 海拔，越高越难 */
export const diffOfProgress = (score, altM) => {
  const dScore = Math.max(0, Math.min(1, score / 90));
  const dAlt = Math.max(0, Math.min(1, altM / SUMMIT_ALT_M));
  return Math.min(1, dScore * 0.4 + dAlt * 0.85);
};

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

/** 为无尽模式生成的云附加变体 */
export const applyPlatformVariant = (p, diff, altM, forceKind) => {
  const tier = tierOf(altM);
  if (p.isStart || p.isGoal || p.isSummit) return p;

  // 双频云：必须跳对 ·/—
  if (!forceKind && tier >= 2 && Math.random() < 0.08 + diff * 0.14) {
    p.dual = true;
    p.requiredSym = Math.random() < 0.5 ? '.' : '-';
    p.kind = 'both';
    p.w = Math.min(200, p.w * 1.12);
  }

  // 碎云：落台后 1.1s 消散
  if (!forceKind && tier >= 2 && Math.random() < 0.06 + diff * 0.12) {
    p.fragile = true;
    p.winH = Math.max(40, p.winH * 0.88);
  }

  // 干扰云：显示假符号，落台清空缓冲
  if (!forceKind && tier >= 3 && Math.random() < 0.05 + diff * 0.1) {
    p.decoy = true;
    p.fakeKind = p.kind === 'dot' ? 'dash' : p.kind === 'dash' ? 'dot' : choice(['dot', 'dash']);
  }

  // 中继站：超宽 + 提示缩写
  if (!forceKind && tier >= 1 && Math.random() < 0.04 + diff * 0.06) {
    p.relay = true;
    p.w = Math.min(200, Math.max(p.w, 150));
    p.winH = Math.min(130, p.winH * 1.15);
    p.kind = 'both';
  }

  // 听码云：落台播放摩斯
  if (!forceKind && tier >= 4 && Math.random() < 0.05 + diff * 0.08) {
    p.listen = true;
    p.listenCode = choice(['.-', '-...', '...', '--', '-.-']);
  }

  // 封蜡云（无尽彩蛋）：需 PERFECT
  if (!forceKind && tier >= 3 && Math.random() < 0.03 + diff * 0.05) {
    p.waxSeal = true;
    p.w = Math.min(180, p.w * 1.05);
  }

  // 漂移 + 侧风区叠加
  if (tier >= 1 && p.moving) {
    p.windZone = true;
  }

  return p;
};

export const shouldSpawnSummit = (altM, platforms) => (
  altM >= SUMMIT_ALT_M * 0.94 && !platforms.some((p) => p.isSummit)
);

export const createSummitPlatform = (prev, vw) => ({
  y: prev.y + rand(175, 210),
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
    if (p.letterIdx === midLetter && p.symIdx === 0) { branchAt = i; break; }
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
