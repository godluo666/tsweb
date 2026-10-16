import test from 'node:test';
import assert from 'node:assert/strict';
import { once, on } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamSpeakSession } from '../server/teamspeak.js';
import { readConfig } from '../server/config.js';
import OpusScript from 'opusscript';
import { parseServerAddress } from '../server/address.js';

async function waitForView(session, ready) {
  const changes = on(session, 'change', { signal: AbortSignal.timeout(5000) });
  try {
    let snapshot = await session.snapshot();
    if (ready(snapshot)) return snapshot;
    for await (const _ of changes) {
      snapshot = await session.snapshot();
      if (ready(snapshot)) return snapshot;
    }
  } finally { await changes.return(); }
}

test('真实 TS3：两位成员进入、收发文字和 Opus 语音、断开释放连接', { timeout: 90_000 }, async () => {
  assert.ok(process.env.TS_HOST, '需要 TS_HOST 指向测试 TeamSpeak 服务器');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tsweb-live-'));
  const config = { ...readConfig(), dataDir };
  const port = process.env.TS_PORT || 9987;
  const target = { ...parseServerAddress(`${process.env.TS_HOST}:${port}`), password: process.env.TS_PASSWORD || '' };
  const domainTarget = { ...parseServerAddress(`${process.env.TS_TEST_DOMAIN || process.env.TS_HOST}:${port}`), password: target.password };
  const alice = new TeamSpeakSession(config, '11111111-1111-4111-8111-111111111111', 'TSWeb Alice', target);
  const bob = new TeamSpeakSession(config, '22222222-2222-4222-8222-222222222222', 'TSWeb Bob', domainTarget);
  const decoder = new OpusScript(48000, 1, OpusScript.Application.VOIP);
  try {
    // The server may still be starting when CI creates the container.
    await delay(Number(process.env.TS_STARTUP_DELAY || 5000));
    await alice.connect();
    await bob.connect();
    const snapshot = await waitForView(alice, value => value.clients.some(client => client.name === 'TSWeb Bob'));
    assert.ok(snapshot.channels.length > 0);
    assert.ok(snapshot.clients.some(client => client.name === 'TSWeb Bob'));
    assert.notEqual(snapshot.channelId, '0');
    const statsDeadline = Date.now() + 6000;
    while (alice.connectionStats().tsRttMs === null && Date.now() < statsDeadline) await delay(20);
    const stats = alice.connectionStats();
    assert.ok(stats.tsRttMs !== null && stats.tsRttMs >= 0, '原生 UDP Pong 应提供实际延迟');
    assert.equal(stats.packetLossPercent, 0);
    assert.ok(stats.probes > 0);
    const textReceived = once(bob, 'chat', { signal: AbortSignal.timeout(10_000) });
    const sent = await alice.chat('你好，TeamSpeak <>& | \\ /');
    assert.equal((await textReceived)[0].text, sent.text);
    const voiceReceived = once(bob, 'voice', { signal: AbortSignal.timeout(10_000) });
    const pcm = Buffer.alloc(1920);
    for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / 48000)), i * 2);
    for (let frame = 0; frame < 10; frame++) { alice.pcm(pcm); await delay(20); }
    const voice = (await voiceReceived)[0];
    assert.equal(voice.codec, 4);
    assert.ok(decoder.decode(Buffer.from(voice.data)).length > 0);
    const defaultChannel = snapshot.channelId;
    await alice.client.execCommand('channelcreate channel_name=TSWeb-test-channel channel_codec=4 channel_flag_temporary=1');
    const createdView = await waitForView(alice, value => value.channels.some(channel => channel.name === 'TSWeb-test-channel'));
    const created = createdView.channels.find(channel => channel.name === 'TSWeb-test-channel');
    assert.ok(created, '新频道应通过原生通知进入频道树');
    await alice.client.execCommand(`channeledit cid=${created.id} channel_codec_quality=6 channel_topic=Integration\\sTopic channel_description=Integration\\sDescription`);
    const info = await bob.channelInfo(created.id);
    assert.equal(info.topic, 'Integration Topic');
    assert.equal(info.description, 'Integration Description');
    assert.equal(info.quality, 6);
    assert.equal((await bob.snapshot()).channelId, defaultChannel);
    await bob.move(created.id, '');
    assert.equal((await waitForView(bob, value => value.channelId === created.id)).channelId, created.id);
    await alice.move(defaultChannel, '');
    await bob.move(defaultChannel, '');
    await alice.audioState(true, false);
    assert.equal(alice.muted, true);
    await bob.close();
    const afterLeave = await waitForView(alice, value => !value.clients.some(client => client.name === 'TSWeb Bob'));
    assert.equal(afterLeave.clients.some(client => client.name === 'TSWeb Bob'), false);
  } finally {
    decoder.delete();
    await alice.close(); await bob.close();
    await rm(dataDir, { recursive: true });
  }
});
