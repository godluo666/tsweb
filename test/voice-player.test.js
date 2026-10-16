import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { VoiceAudio } from '../web/audio.js';

const source = await readFile(new URL('../public/voice-player-worklet.js', import.meta.url), 'utf8');
function player() {
  let Processor;
  const context = {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    currentTime: 0, sampleRate: 48000, Float32Array,
    registerProcessor(_name, value) { Processor = value; },
  };
  vm.runInNewContext(source, context);
  return new Processor();
}
function pcm(instance, clientId, value) {
  const samples = new Float32Array(1920).fill(value);
  instance.port.onmessage({ data: { type: 'pcm', clientId, left: samples, right: samples } });
}
function sample(instance) {
  const left = new Float32Array(128), right = new Float32Array(128);
  instance.process([], [[left, right]]);
  assert.equal(left[0], right[0]);
  return left[0];
}

test('单独静音或放大一位成员，另一位成员的混音音量保持正确', () => {
  for (const gain of [0, 0.5, 1, 2]) {
    const instance = player();
    const audio = new VoiceAudio(() => {}, () => {});
    audio.player = { port: { postMessage: data => instance.port.onmessage({ data }) } };
    audio.setUserVolume(10, gain);
    pcm(instance, 10, 0.03);
    pcm(instance, 20, 0.02);
    assert.ok(Math.abs(sample(instance) - Math.tanh(0.03 * gain + 0.02)) < 1e-6);
  }
});

test('切换频道保留成员增益，移除成员后清除旧增益并释放解码器', async () => {
  const instance = player();
  const audio = new VoiceAudio(() => {}, () => {});
  audio.player = { port: { postMessage: data => instance.port.onmessage({ data }) } };
  audio.setUserVolume(10, 0);
  audio.reset();
  pcm(instance, 10, 0.03);
  assert.equal(sample(instance), 0);
  let freed = 0;
  audio.decoders.set(10, { ready: Promise.resolve(), decoder: { free() { freed++; } } });
  audio.syncUsers([]);
  await Promise.resolve();
  assert.equal(audio.userVolumes.has(10), false);
  assert.equal(audio.decoders.has(10), false);
  assert.equal(freed, 1);
  audio.reset();
  pcm(instance, 10, 0.03);
  assert.ok(Math.abs(sample(instance) - Math.tanh(0.03)) < 1e-6);
});
