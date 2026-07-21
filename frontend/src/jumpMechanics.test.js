import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUD_STAND_LIFE,
  cloudLifeRatio,
  isTimedCloud,
  restoreCloudRoute,
  tickCloudLife,
} from './jumpMechanics.js';

test('普通云统一使用三秒停留时限', () => {
  assert.equal(CLOUD_STAND_LIFE, 3);
  assert.equal(isTimedCloud({ kind: 'dot' }), true);
  assert.equal(isTimedCloud({ isStart: true }), true);
});

test('终点信箱与天门不启动停留倒计时', () => {
  assert.equal(isTimedCloud({ isGoal: true }), false);
  assert.equal(isTimedCloud({ isSummit: true }), false);
  assert.equal(isTimedCloud(null), false);
});

test('云生命周期按帧时间递减且不会越过零点', () => {
  assert.equal(tickCloudLife(3, 0.25), 2.75);
  assert.equal(tickCloudLife(0.1, 0.2), 0);
  assert.equal(tickCloudLife(1, -1), 1);
});

test('云生命周期比例始终钳制在零到一', () => {
  assert.equal(cloudLifeRatio(3), 1);
  assert.equal(cloudLifeRatio(1.5), 0.5);
  assert.equal(cloudLifeRatio(-1), 0);
  assert.equal(cloudLifeRatio(9), 1);
});

test('任务重发会恢复当前字母后续的消散云路', () => {
  const platforms = [
    { spent: true, broken: true },
    { spent: true, spentAge: 1, broken: true, breakAge: 1, lifeActive: true, lifeRemaining: 0.4 },
    { spent: true, broken: false },
  ];

  restoreCloudRoute(platforms, 1);

  assert.equal(platforms[0].spent, true);
  assert.deepEqual(platforms[1], {
    spent: false,
    spentAge: 0,
    broken: false,
    breakAge: 0,
    lifeActive: false,
    lifeRemaining: 0,
  });
  assert.equal(platforms[2].spent, false);
  assert.equal(platforms[2].broken, false);
});
