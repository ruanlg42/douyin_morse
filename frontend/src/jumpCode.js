/* =========================================================
   jumpCode.js — 关卡码：单词 ↔ 可分享加密码（自包含、可逆）
   - 纯前端、无后端：码里自带单词，B 的客户端解码后生成关卡。
   - 视觉上看不出原词（逐位置扰码 + 前缀 + 校验位），但客户端可解。
   - 形如 MC-K7P9-Q3，通关后揭晓真正单词。
   ========================================================= */

// Crockford 风格 base32（去掉易混的 I L O U），共 32 个字符
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VAL = {};
[...ALPHABET].forEach((c, i) => { VAL[c] = i; });

// 逐位置旋转盐：让同一字母在不同位置映射成不同字符，肉眼看不出规律
const SALT = [11, 23, 5, 17, 29, 3, 19, 13, 25, 7, 31, 15];
const rot = (i) => (SALT[i % SALT.length] + i * 7) % 32;

export const CODE_PREFIX = 'MC';
const MIN_LEN = 2;
const MAX_LEN = 8;

/** 规范化单词：大写、仅保留 A-Z。返回 '' 表示非法。 */
export const normalizeWord = (raw) => {
  const w = (raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (w.length < MIN_LEN || w.length > MAX_LEN) return '';
  return w;
};

/** 把 body 字符按 4 个一组用短横分隔，并加 MC- 前缀 */
const formatCode = (body) => {
  const groups = [];
  for (let i = 0; i < body.length; i += 4) groups.push(body.slice(i, i + 4));
  return `${CODE_PREFIX}-${groups.join('-')}`;
};

/**
 * 单词 → 关卡码。非法单词返回 ''。
 * body = [长度位][每字母一位][校验位]，全部映射进 base32。
 */
export const encodeLevelCode = (word) => {
  const w = normalizeWord(word);
  if (!w) return '';
  const len = w.length;
  const chars = [];
  // 位置 0：长度
  chars.push(ALPHABET[(len + rot(0)) % 32]);
  let sum = len;
  w.split('').forEach((ch, i) => {
    const v = ch.charCodeAt(0) - 65; // 0..25
    sum += v;
    chars.push(ALPHABET[(v + rot(i + 1)) % 32]);
  });
  // 末位：校验（不旋转，便于校验）
  chars.push(ALPHABET[sum % 32]);
  return formatCode(chars.join(''));
};

/** 清洗用户输入：大写、归并易混字符、剥掉前缀与非字母数字 */
const sanitize = (raw) => {
  let s = (raw || '').toUpperCase().trim();
  // 归并 Crockford 易混字符
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  s = s.replace(/[^0-9A-Z]/g, '');           // 去掉短横/空格等
  if (s.startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length);
  return s;
};

/**
 * 关卡码 → { ok, word } 。
 * 校验：字符集、长度自洽、字母范围、校验位。任一不符 ok=false。
 */
export const decodeLevelCode = (raw) => {
  const body = sanitize(raw);
  if (body.length < MIN_LEN + 2) return { ok: false };   // 至少 长度位+1字母+校验位
  for (const c of body) if (!(c in VAL)) return { ok: false };

  const len = (VAL[body[0]] - rot(0) + 320) % 32;
  if (len < MIN_LEN || len > MAX_LEN) return { ok: false };
  if (body.length !== len + 2) return { ok: false };      // 长度位 + len 字母 + 校验位

  let sum = len;
  let word = '';
  for (let i = 0; i < len; i++) {
    const v = (VAL[body[1 + i]] - rot(i + 1) + 320) % 32;
    if (v > 25) return { ok: false };                     // 非 A-Z
    sum += v;
    word += String.fromCharCode(65 + v);
  }
  const check = VAL[body[1 + len]];
  if (check !== sum % 32) return { ok: false };
  return { ok: true, word };
};

/** 仅判断一个字符串是否是合法关卡码 */
export const isValidLevelCode = (raw) => decodeLevelCode(raw).ok;
