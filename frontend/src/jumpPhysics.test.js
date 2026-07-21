import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findSweptLanding,
  jumpHeightForCharge,
  landingQuality,
  platformAcceptsSymbol,
  symbolForCharge,
} from './jumpPhysics.js';

test('点划档位在阈值处稳定切换', () => {
  assert.equal(symbolForCharge(0.399), '.');
  assert.equal(symbolForCharge(0.4), '-');
});

test('正确档位会获得足够的越顶余量', () => {
  assert.equal(jumpHeightForCharge(0, 180, true), 210);
  assert.ok(jumpHeightForCharge(0.41, 250, true) >= 280);
});

test('平台按点划类型接收输入', () => {
  assert.equal(platformAcceptsSymbol({ kind: 'dot' }, '.'), true);
  assert.equal(platformAcceptsSymbol({ kind: 'dot' }, '-'), false);
  assert.equal(platformAcceptsSymbol({ kind: 'both' }, '-'), true);
  assert.equal(platformAcceptsSymbol({ kind: 'both', dual: true, requiredSym: '.' }, '-'), false);
});

test('高速下落跨过云面时仍能连续命中', () => {
  const platforms = [
    { y: 0, cx: 100, w: 120 },
    { y: 120, cx: 140, w: 100 },
  ];
  const hit = findSweptLanding({
    platforms,
    fromIdx: 0,
    previousAlt: 155,
    currentAlt: 86,
    previousX: 130,
    currentX: 150,
  });
  assert.equal(hit?.index, 1);
  assert.ok(hit.landingX >= 130 && hit.landingX <= 150);
});

test('不会越过下一层误吸到更高平台', () => {
  const platforms = [
    { y: 0, cx: 100, w: 120 },
    { y: 100, cx: 20, w: 40 },
    { y: 200, cx: 100, w: 140 },
  ];
  const hit = findSweptLanding({
    platforms,
    fromIdx: 0,
    previousAlt: 220,
    currentAlt: 180,
    previousX: 100,
    currentX: 100,
  });
  assert.equal(hit, null);
});

test('落点按横向误差区分完美、稳定和擦边', () => {
  const platform = { cx: 100, w: 120 };
  assert.equal(landingQuality(platform, 108), 'perfect');
  assert.equal(landingQuality(platform, 125), 'clean');
  assert.equal(landingQuality(platform, 150), 'edge');
});
