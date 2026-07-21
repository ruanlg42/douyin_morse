// jumpCode 关卡码：单词 + seed 往返 + 随机可复现的回归测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeLevelCode, decodeLevelCode, isValidLevelCode, normalizeMessage, SEED_MAX, MSG_MAX_LEN } from './jumpCode.js';
import { resetLevelRng, lrand } from './jumpMechanics.js';

// 采样一段确定性 rng 序列（模拟关卡布局用到的随机数）
const sampleSeq = (seed, n = 12) => {
  resetLevelRng(seed >>> 0);
  return Array.from({ length: n }, () => lrand(0, 1000));
};

test('单词 + seed 往返：能一一解析回原词与原 seed', () => {
  const cases = [
    ['LOVE', 0],
    ['HOME', 1],
    ['STAR', 12345],
    ['DREAM', SEED_MAX - 1],
    ['SOS', 777],
    ['MOONRISE'.slice(0, 8), 30000],
  ];
  for (const [word, seed] of cases) {
    const code = encodeLevelCode(word, seed);
    const r = decodeLevelCode(code);
    assert.equal(r.ok, true, `应可解码：${word}/${seed} → ${code}`);
    assert.equal(r.word, word);
    assert.equal(r.seed, seed % SEED_MAX);
  }
});

test('同词不同 seed → 关卡码不同', () => {
  const a = encodeLevelCode('LOVE', 1);
  const b = encodeLevelCode('LOVE', 2);
  assert.notEqual(a, b);
});

test('校验位生效：篡改一位即失效', () => {
  const code = encodeLevelCode('STAR', 999);
  // 找到 body 里第一个字母数字并替换成另一个字符
  const idx = [...code].findIndex((c, i) => i > 3 && /[0-9A-Z]/.test(c));
  const swapped = code.slice(0, idx) + (code[idx] === 'Q' ? 'R' : 'Q') + code.slice(idx + 1);
  assert.equal(isValidLevelCode(swapped), false);
});

test('非法输入返回 ok:false，不抛错', () => {
  assert.equal(decodeLevelCode('').ok, false);
  assert.equal(decodeLevelCode('MC-XXXX').ok, false);
  assert.equal(decodeLevelCode('随便乱写').ok, false);
});

test('确定性 rng：同 seed 复现同一序列', () => {
  assert.deepEqual(sampleSeq(12345), sampleSeq(12345));
});

test('确定性 rng：不同 seed 产出不同序列（随机性）', () => {
  assert.notDeepEqual(sampleSeq(1), sampleSeq(2));
});

test('端到端：解码出的 seed 喂回 rng 能复现 A 的序列', () => {
  const seed = (Math.floor(Math.random() * SEED_MAX));
  const code = encodeLevelCode('DREAM', seed);
  const { seed: decoded } = decodeLevelCode(code);
  assert.deepEqual(sampleSeq(decoded), sampleSeq(seed));
});

test('整句往返：含空格 / 数字 / 标点都能一一可逆', () => {
  const cases = [
    ['SEE U @ 8', 0],
    ['GO HOME!', 123],
    ['I MISS U, DEAR.', 4096],
    ['CALL 911?', SEED_MAX - 1],
    ['MOON RIVER', 20000],
    ["DON'T GO", 5],
  ];
  for (const [msg, seed] of cases) {
    const norm = normalizeMessage(msg);
    const code = encodeLevelCode(msg, seed);
    const r = decodeLevelCode(code);
    assert.equal(r.ok, true, `应可解码：${msg}/${seed} → ${code}`);
    assert.equal(r.word, norm, `原文应复现：${msg} → ${norm}`);
    assert.equal(r.seed, seed % SEED_MAX);
  }
});

test('规范化：多空格并一、去首尾、大写、过滤非法字符', () => {
  assert.equal(normalizeMessage('  hello   world  '), 'HELLO WORLD');
  assert.equal(normalizeMessage('a\tb'), 'A B');       // 制表符视作空白
  assert.equal(normalizeMessage('日本 love'), 'LOVE'); // 非字符集字符被剔除
  assert.equal(normalizeMessage(''), '');
});

test('长句上限：超过 MSG_MAX_LEN 返回空 / 恰好可用', () => {
  const long = 'A'.repeat(MSG_MAX_LEN + 5);
  assert.equal(normalizeMessage(long), '');
  assert.equal(encodeLevelCode(long, 1), '');
  const ok = 'A'.repeat(MSG_MAX_LEN);
  assert.equal(decodeLevelCode(encodeLevelCode(ok, 1)).word, ok);
});

test('整句：篡改一位即校验失败', () => {
  const code = encodeLevelCode('SEE U @ 8', 321);
  const idx = [...code].findIndex((c, i) => i > 4 && /[0-9A-Z]/.test(c));
  const swapped = code.slice(0, idx) + (code[idx] === 'Q' ? 'R' : 'Q') + code.slice(idx + 1);
  assert.equal(isValidLevelCode(swapped), false);
});
