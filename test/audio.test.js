import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import OpusScript from 'opusscript';
import { OpusDecoder } from 'opus-decoder';
import { loadIdentity } from '../server/teamspeak.js';

test('48 kHz PCM 编码为 TS Opus 后可由网页解码', async () => {
  const encoder = new OpusScript(48000, 1, OpusScript.Application.VOIP);
  const decoder = new OpusDecoder({ sampleRate: 48000, channels: 2 });
  try {
    await decoder.ready;
    let energy = 0, count = 0;
    for (let frame = 0; frame < 12; frame++) {
      const pcm = Buffer.alloc(1920);
      for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * 440 * (frame * 960 + i) / 48000)), i * 2);
      const packet = encoder.encode(pcm, 960);
      const result = decoder.decodeFrame(new Uint8Array(packet));
      assert.equal(result.errors.length, 0);
      assert.equal(result.samplesDecoded, 960);
      if (frame > 2) for (const sample of result.channelData[0]) { energy += sample * sample; count++; }
    }
    const rms = Math.sqrt(energy / count);
    assert.ok(rms > 0.1 && rms < 0.4, `Decoded RMS: ${rms}`);
  } finally { encoder.delete(); decoder.free(); }
});

test('TeamSpeak 身份在重启后保持不变', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tsweb-identity-'));
  try {
    const config = { dataDir, securityLevel: 8 };
    const first = await loadIdentity(config, '11111111-1111-4111-8111-111111111111');
    const second = await loadIdentity(config, '11111111-1111-4111-8111-111111111111');
    assert.equal(first.toString(), second.toString());
    assert.ok(second.securityLevel() >= 8);
    const upgraded = await loadIdentity({ ...config, securityLevel: 10 }, '11111111-1111-4111-8111-111111111111');
    assert.equal(upgraded.publicKeyBase64(), first.publicKeyBase64());
    assert.ok(upgraded.securityLevel() >= 10);
  } finally { await rm(dataDir, { recursive: true }); }
});
