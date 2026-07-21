export const DEFAULT_SYMBOL_SPLIT = 0.4;

export const symbolForCharge = (ratio, split = DEFAULT_SYMBOL_SPLIT) => (
  ratio < split ? '.' : '-'
);

export const platformAcceptsSymbol = (platform, symbol) => {
  if (!platform || platform.isGoal || platform.isSummit) return true;
  if (platform.dual && platform.requiredSym) return platform.requiredSym === symbol;
  if (platform.kind === 'both') return true;
  return platform.kind === (symbol === '.' ? 'dot' : 'dash');
};

/**
 * 将点、划各自映射到稳定的跳高区间。匹配目标云时补足越顶余量，
 * 保证正确档位一定能越过云面，再由下落阶段完成落台。
 */
export const jumpHeightForCharge = (
  ratio,
  targetGap = 0,
  targetAcceptsSymbol = false,
  split = DEFAULT_SYMBOL_SPLIT,
) => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const symbol = symbolForCharge(clamped, split);
  let height;
  if (symbol === '.') {
    const t = Math.min(1, clamped / split);
    height = 112 + t * 78;
  } else {
    const t = Math.min(1, Math.max(0, (clamped - split) / (1 - split)));
    height = 220 + t * 110;
  }
  if (targetAcceptsSymbol && targetGap > 0) {
    height = Math.max(height, targetGap + 30);
  }
  return Math.min(360, height);
};

const nextLayerCandidates = (platforms, fromIdx, layerTolerance = 12) => {
  const first = platforms[fromIdx + 1];
  if (!first) return [];
  const out = [];
  for (let i = fromIdx + 1; i < Math.min(platforms.length, fromIdx + 5); i += 1) {
    const platform = platforms[i];
    if (!platform || platform.broken) continue;
    if (platform.y > first.y + layerTolerance) break;
    if (Math.abs(platform.y - first.y) <= layerTolerance) out.push({ platform, index: i });
  }
  return out;
};

/**
 * 连续碰撞检测：检查夜枭脚底在本帧是否扫过下一层云面，并按扫过时刻插值 X。
 * 这样低帧率或高速下落时也不会穿透平台。
 */
export const findSweptLanding = ({
  platforms,
  fromIdx,
  previousAlt,
  currentAlt,
  previousX,
  currentX,
  horizontalGrace = 7,
  verticalGrace = 4,
}) => {
  if (!Array.isArray(platforms) || currentAlt > previousAlt) return null;
  const fallDistance = Math.max(0.0001, previousAlt - currentAlt);
  let best = null;

  nextLayerCandidates(platforms, fromIdx).forEach(({ platform, index }) => {
    const surface = platform.y;
    const crossed = previousAlt >= surface - verticalGrace
      && currentAlt <= surface + verticalGrace;
    if (!crossed) return;

    const t = Math.max(0, Math.min(1, (previousAlt - surface) / fallDistance));
    const landingX = previousX + (currentX - previousX) * t;
    const horizontalError = Math.abs(landingX - platform.cx);
    if (horizontalError > platform.w / 2 + horizontalGrace) return;

    if (!best || horizontalError < best.horizontalError) {
      best = { index, landingX, horizontalError };
    }
  });
  return best;
};

export const landingQuality = (platform, landingX, perfectTolerance = 13) => {
  if (!platform) return 'miss';
  const error = Math.abs(landingX - platform.cx);
  if (error <= perfectTolerance) return 'perfect';
  if (error <= platform.w * 0.34) return 'clean';
  return 'edge';
};
