/* =========================================================
   jumpDict.js — 摩斯跳一跳 单词词典 & 技能映射
   - SKILL_WORDS：触发专属技能（5 个核心词）
   - COMMON_WORDS：仅给基础加分 + 飘字特效（约 90 个常见 3–5 字母词）
   ========================================================= */

/** 5 个专属技能词。kind 是 JumpGame 内消费的"指令"。 */
export const SKILL_WORDS = {
  STAR: { kind: 'star', desc: '流星雨 +50',           color: '#fff5d8' },
  WIN:  { kind: 'win',  desc: '下一跳必中 PERFECT',   color: '#a7f3d0' },
  GOLD: { kind: 'gold', desc: '5 跳得分 ×2',          color: '#f2d27a' },
  SOS:  { kind: 'sos',  desc: '复活护盾，挡一次落空', color: '#fca5a5' },
  SKY:  { kind: 'sky',  desc: '下一块变超宽桥',       color: '#bae6fd' },
  FOX:  { kind: 'fox',  desc: '3 跳迷雾伪装云高',     color: '#fdba74' },
  OWL:  { kind: 'owl',  desc: '预览接下来 5 朵云',    color: '#c4b5fd' },
  MOON: { kind: 'moon', desc: '5 跳低重力飘升',       color: '#e9d5ff' },
  RAIN: { kind: 'rain', desc: '5 朵云自动变宽',      color: '#7dd3fc' },
  CODE: { kind: 'code', desc: '自动纠错一次摩斯',     color: '#86efac' },
};

/** 通用词典（命中给 +5×字长 分 + 小特效；不触发技能）。
 *  全大写、≥3 字母；保持常见单词，让玩家容易拼出。 */
export const COMMON_WORDS = [
  // 3-letter
  'THE','AND','FOR','ARE','BUT','NOT','YOU','ALL','CAN','HER','WAS','ONE','OUR',
  'DAY','GET','HAS','HOW','MAN','NEW','NOW','OUT','OLD','SEE','TWO','WAY','WHO',
  'BOY','DID','SAY','SHE','TOO','USE','ANY','CAR','DOG','EYE','FAR','FUN','HOT',
  'RED','RUN','SEA','SUN','WAR','YES','ZOO','BAR','BAT','BED','BEE','BIG','BIT',
  'BOX','BUS','BYE','CAP','CAT','CUP','CUT','EAR','EGG','END','FIT','FLY','FOG',
  'GAS','GAP','HAT','HIT','HOP','ICE','INK','JAR','JOB','JOY','KEY','KID','LAB',
  'LAP','LEG','LIP','LOT','MAP','MOM','NET','OWL','PEN','PET','PIG','RAT','ROW',
  'SAW','SET','SIT','SKI','TEA','TEN','TIE','TIP','TOP','TOY','VAN','WAX','WET',
  'ZIP','RAY','BOW','OWE','ART','ACE','AIR','AGE','BAY','BUG','CAB','COW','CRY',
  'CQ','OK',
  'DAD','DUE','EVE','FAN','FEE','FIG','GAY','GUM','GUN','HEN','HUG','HUT','JET',
  'LAW','LOW','MAD','MIX','MUD','NUT','OAK','OAT','OFF','OWN','PAY','PIE','PIN',
  'POP','PUB','PUP','RAG','RIB','RIP','ROB','ROD','SAD','SHY','SIN','SIP','SIR',
  'SOY','SPA','TAB','TAG','TAR','TIN','TUG','VOW','WED','WIG','YAK','YAM',
  // 4-letter
  'GAME','MOON','CODE','BEAT','FREE','FIRE','FISH','LOVE','MIND','ROCK','BIRD',
  'WIND','RAIN','SNOW','RIDE','TIME','DUSK','DAWN','SOUL','WISH','FATE','OATH',
  'BOND','LINK','PATH','GLOW','WAVE','TUNE','SONG','BEAM','DEEP','BLUE','SOFT',
  'HARD','TALL','WIDE','THIN','BUSY','EASY','OPEN','SHUT','TINY','HUGE','GIFT',
  'RING','KING','LION','SAIL','LEAF','TREE','ROOT','HILL','WORD','TRUE','FACT',
  'HOPE','CARE','FACE','HEAD','PARK','PLAY','READ','RACE','SAFE','SAVE','TALK',
  'TASK','TEAM','TEST','WALK','WORK','YEAR','ZERO','HERO','JUMP','FOX',
  // 5-letter
  'MAGIC','POWER','MUSIC','BEACH','OCEAN','DREAM','LIGHT','SOUND','HEART',
  'BRAVE','SHARP','RAPID','SWIFT','CLEAR','CROWN','SHINE','BLAZE','FLAME',
  'SPARK','STORM','WORLD','BLOOM','PROUD','RIVER','GRACE','SMILE','HONEY',
  'PEARL','POINT','PRESS','PRIDE','QUEST','QUIET','ROYAL','SHADE','SLEEP',
  'SMART','SPACE','SPELL','TIGER','TRAIN','TRUST','UNITY','VIVID','VOICE',
  'WATCH','YIELD','ZEBRA',
];

/** 综合词典 Set：技能词 + 通用词。检索都查这一份。 */
export const ALL_WORDS = new Set([
  ...Object.keys(SKILL_WORDS),
  ...COMMON_WORDS,
]);

/** 在 wordBuf 末尾找最长匹配单词（≥3 字母）。命中返回 word，否则返回 null。 */
export const findWordAtTail = (wordBuf) => {
  const max = Math.min(wordBuf.length, 7);
  for (let len = max; len >= 3; len--) {
    const tail = wordBuf.slice(-len);
    if (ALL_WORDS.has(tail)) return tail;
  }
  return null;
};

/** 常见词中文联想（助记，非全量翻译） */
export const WORD_HINTS_CN = {
  LOVE: '爱', HOME: '家', MOON: '月', STAR: '星', DREAM: '梦',
  HOPE: '希望', FIRE: '火', WAVE: '浪', WIND: '风', RAIN: '雨',
  SNOW: '雪', CODE: '码', GAME: '戏', HERO: '英雄', JUMP: '跳',
  OWL: '猫头鹰', SOS: '求救', SKY: '天', GOLD: '金', WIN: '胜',
  MAGIC: '魔法', HEART: '心', LIGHT: '光', MUSIC: '音乐',
  SOUL: '灵魂', WISH: '愿', TIME: '时', DAWN: '黎明', DUSK: '黄昏',
  CQ: '呼叫', OK: '确认',
  TREE: '树', KING: '王', GLOW: '光', BEAM: '束',
};

/** 单个词的联想文案（技能词优先展示秘技说明） */
export const getWordMnemonic = (word) => {
  const w = (word || '').toUpperCase();
  if (!w) return '';
  const skill = SKILL_WORDS[w];
  const cn = WORD_HINTS_CN[w];
  if (skill && cn) return `${cn} · ${skill.desc}`;
  if (skill) return skill.desc;
  if (cn) return cn;
  return '';
};

/** 寄信模式：整词联想标题 */
export const getMissionWordHint = (word) => {
  const w = (word || '').toUpperCase();
  const hint = getWordMnemonic(w);
  return hint ? `${w} → ${hint}` : w;
};

/**
 * 根据已拼字母前缀，联想可能完成的单词（无尽模式顶部提示）
 * 技能词优先，最多返回 limit 条
 */
export const findWordPrefixHints = (prefix, limit = 3) => {
  const p = (prefix || '').toUpperCase();
  if (!p) return [];
  const out = [];
  for (const w of ALL_WORDS) {
    if (!w.startsWith(p) || w.length <= p.length) continue;
    const skill = SKILL_WORDS[w];
    out.push({
      word: w,
      tail: w.slice(p.length),
      isSkill: !!skill,
      hint: getWordMnemonic(w),
      priority: skill ? 0 : (WORD_HINTS_CN[w] ? 1 : 2),
    });
  }
  out.sort((a, b) => a.priority - b.priority || a.word.length - b.word.length);
  return out.slice(0, limit);
};
