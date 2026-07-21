/* =========================================================
   jumpCode.js — 关卡码：整句消息 + seed ↔ 可分享加密码（自包含、可逆）
   - 纯前端、无后端：码里自带「消息 + 布局种子(seed)」，B 的客户端解码后
     用同一确定性 rng 逐像素重建 A 看到的那张关卡。
   - 支持整句：空格（词间停顿）+ A-Z + 0-9 + 常用标点。
   - seed 让「同句每次布局不同」，又能被编码复现 → 随机性与可复现并存。
   - 原理：把「校验 · 长度 · seed · 每个字符」按混合基打包成一个 BigInt，
     再变基成 Crockford base32，逐位叠加旋转盐 → 肉眼看不出原文。
   - 形如 MC-K7P9-Q3TW-…，通关后揭晓真正内容。
   ========================================================= */

// Crockford 风格 base32（去掉易混的 I L O U），共 32 个字符
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VAL = {};
[...ALPHABET].forEach((c, i) => { VAL[c] = i; });

// 逐位置旋转盐：让同一数值在不同位置映射成不同字符，肉眼看不出规律
const SALT = [11, 23, 5, 17, 29, 3, 19, 13, 25, 7, 31, 15];
const rot = (i) => (SALT[i % SALT.length] + i * 7) % 32;

export const CODE_PREFIX = 'MC';

// seed 占 15 bit = 32768 种布局：让「同一句话每次都不一样」，又能被复现。
export const SEED_MAX = 1 << 15;   // 32768

// 消息字符集（下标 0 必须是空格，作为词间停顿）：
// 空格 + A-Z + 0-9 + 常用标点。除空格外每个字符都能在 FULL_MORSE 里发码。
export const MESSAGE_CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?'!/():;=+-_\"@$&";
const CHAR_TO_IDX = {};
[...MESSAGE_CHARSET].forEach((c, i) => { CHAR_TO_IDX[c] = i; });

export const MSG_MIN_LEN = 1;
export const MSG_MAX_LEN = 40;      // 长句上限：一句话足够，防止码长到离谱

/**
 * 规范化消息：大写、只保留字符集内的字符、把连续空格并成一个、去首尾空格。
 * 返回 '' 表示为空/非法（长度越界）。
 */
export const normalizeMessage = (raw) => {
  let s = (raw || '').toUpperCase();
  // 常见等价标点归一，降低输入门槛
  s = s.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/\s+/g, ' ');               // 任意空白（含制表符）统一成空格
  s = [...s].filter((c) => c in CHAR_TO_IDX).join('');
  s = s.replace(/\s+/g, ' ').trim();        // 再次并空格 + 去首尾
  if (s.length < MSG_MIN_LEN || s.length > MSG_MAX_LEN) return '';
  return s;
};

/** 向后兼容：旧「单词」入口，等价于 normalizeMessage（不再限制 2~8） */
export const normalizeWord = (raw) => normalizeMessage(raw);

/** 把 body 字符按 4 个一组用短横分隔，并加 MC- 前缀 */
const formatCode = (body) => {
  const groups = [];
  for (let i = 0; i < body.length; i += 4) groups.push(body.slice(i, i + 4));
  return `${CODE_PREFIX}-${groups.join('-')}`;
};

/** 位置加权校验（10 bit）：Σ (unit+1)*(i*31+7) % 1024，改动任一单元都会变化 */
const checksum = (units) =>
  units.reduce((acc, v, i) => (acc + (v + 1) * (i * 31 + 7)) % 1024, 0);

/**
 * 消息 + seed → 关卡码。非法消息返回 ''。
 * 全程只用 5-bit 单元（0..31），避免 BigInt（iOS Safari 13 不支持）。
 * body 单元顺序（未旋转前）：
 *   [0..1]              长度 len（hi=len>>5, lo=len&31，支持到 40）
 *   [2..4]             seed 15 bit（高/中/低各 5 bit）
 *   [5..5+2*len)       每个字符 2 单元（hi=idx>>5(0..1), lo=idx&31，字符集 0..54）
 *   [末 2 位]          校验 = (len+seed+Σidx)%1024 的 hi/lo
 * 每个单元再叠加 rot(i) 旋转盐 → base32 字符，肉眼看不出规律。
 */
export const encodeLevelCode = (message, seed = 0) => {
  const msg = normalizeMessage(message);
  if (!msg) return '';
  const s = ((Math.trunc(seed) % SEED_MAX) + SEED_MAX) % SEED_MAX;
  const idxs = [...msg].map((c) => CHAR_TO_IDX[c]);

  // 先拼出「内容单元」（长度 + seed + 每字符），再对其做位置加权校验
  const units = [];
  units.push((msg.length >> 5) & 31, msg.length & 31);   // 长度 hi/lo
  units.push((s >> 10) & 31, (s >> 5) & 31, s & 31);     // seed 高/中/低
  for (const idx of idxs) units.push((idx >> 5) & 31, idx & 31); // 每字符 hi/lo
  // 位置加权校验：任一单元被改都会变（权重与位置绑定，避免整数倍抵消）
  const check = checksum(units);
  units.push((check >> 5) & 31, check & 31);             // 校验 hi/lo

  const body = units.map((v, i) => ALPHABET[(v + rot(i)) % 32]).join('');
  return formatCode(body);
};

/** 清洗用户输入：大写、归并易混字符、剥掉前缀与非 base32 字符 */
const sanitize = (raw) => {
  let s = (raw || '').toUpperCase().trim();
  if (s.startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length);   // 先剥前缀
  // 归并 Crockford 易混字符（body 本身不含 I/L/O/U，仅纠正手抄误差）
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  s = s.replace(/[^0-9A-Z]/g, '');           // 去掉短横/空格等
  return s;
};

/**
 * 关卡码 → { ok, word, seed } 。（word 即整句消息，可含空格标点）
 * 校验：字符集、长度自洽、字符下标范围、校验位。任一不符 ok=false。
 */
export const decodeLevelCode = (raw) => {
  const body = sanitize(raw);
  if (body.length < 2 + 3 + 2 + 2) return { ok: false };   // 长度+seed+至少1字符+校验
  for (const c of body) if (!(c in VAL)) return { ok: false };

  // 反旋转还原每个单元的原始 5-bit 值 0..31
  const u = [...body].map((c, i) => (((VAL[c] - rot(i)) % 32) + 32) % 32);

  const len = (u[0] << 5) | u[1];
  if (len < MSG_MIN_LEN || len > MSG_MAX_LEN) return { ok: false };
  // 长度自洽：长度(2)+seed(3)+2*len 字符+校验(2)
  if (body.length !== 2 + 3 + 2 * len + 2) return { ok: false };

  const seed = (u[2] << 10) | (u[3] << 5) | u[4];

  const idxs = [];
  for (let i = 0; i < len; i++) {
    const idx = (u[5 + 2 * i] << 5) | u[5 + 2 * i + 1];
    if (idx >= MESSAGE_CHARSET.length) return { ok: false };   // 非法字符下标
    idxs.push(idx);
  }
  const word = idxs.map((v) => MESSAGE_CHARSET[v]).join('');

  const check = (u[u.length - 2] << 5) | u[u.length - 1];
  // 用与编码一致的位置加权校验，比对内容单元（不含末尾 2 位校验）
  const expect = checksum(u.slice(0, u.length - 2));
  if (expect !== check) return { ok: false };
  return { ok: true, word, seed };
};

/** 仅判断一个字符串是否是合法关卡码 */
export const isValidLevelCode = (raw) => decodeLevelCode(raw).ok;
