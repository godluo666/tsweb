import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStats } from '../server/connection-stats.js';

test('UDP 探测按回应计算延迟，等待中的探测不算丢包', () => {
  let now = 0;
  const stats = new ConnectionStats(() => now);
  assert.deepEqual(stats.snapshot(), { tsRttMs: null, packetLossPercent: null, probes: 0, windowSeconds: 60 });
  stats.sent(65535);
  now = 25;
  stats.received(65535);
  assert.equal(stats.snapshot().tsRttMs, 25);
  assert.equal(stats.snapshot().packetLossPercent, 0);
  now = 5000;
  stats.sent(0);
  now = 9999;
  assert.equal(stats.snapshot().probes, 1);
  assert.equal(stats.snapshot().packetLossPercent, 0);
  now = 10_000;
  assert.equal(stats.snapshot().probes, 2);
  assert.equal(stats.snapshot().packetLossPercent, 50);
  now = 11_000;
  stats.received(0);
  assert.equal(stats.snapshot().packetLossPercent, 50);
});

test('旧延迟和超过一分钟的探测过期后显示无数据', () => {
  let now = 100;
  const stats = new ConnectionStats(() => now);
  stats.sent(1);
  now = 110;
  stats.received(1);
  now = 15_111;
  assert.equal(stats.snapshot().tsRttMs, null);
  now = 60_101;
  assert.deepEqual(stats.snapshot(), { tsRttMs: null, packetLossPercent: null, probes: 0, windowSeconds: 60 });
});
