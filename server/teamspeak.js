import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, generateIdentity, identityFromString, clientMove, noopLogger } from '@honeybbq/teamspeak-client';
import { buildCommand } from '@honeybbq/teamspeak-client/command';
import OpusScript from 'opusscript';
import { ServerView } from './view.js';

export async function loadIdentity(config, key) {
  await mkdir(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, `${key}.identity`);
  let identity;
  try {
    identity = identityFromString(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    identity = generateIdentity(8);
  }
  if (identity.securityLevel() < config.securityLevel) {
    await identity.upgradeToLevel(config.securityLevel);
  }
  await writeFile(file, identity.toString(), { mode: 0o600 });
  return identity;
}

export class TeamSpeakSession extends EventEmitter {
  constructor(config, key, nickname) {
    super();
    Object.assign(this, { config, key, nickname, muted: false, deafened: false, closed: false });
    this.view = new ServerView(() => this.emit('change'));
  }

  async connect() {
    const identity = await loadIdentity(this.config, this.key);
    if (this.closed) return;
    const host = this.config.tsHost.includes(':') && !this.config.tsHost.startsWith('[')
      ? `[${this.config.tsHost}]` : this.config.tsHost;
    this.client = new Client(identity, `${host}:${this.config.tsPort}`, this.nickname, {
      serverPassword: this.config.serverPassword,
      logger: noopLogger,
    });
    this.client.on('voiceData', frame => {
      if (!this.closed && !this.deafened && (frame.codec === 4 || frame.codec === 5)) {
        this.emit('voice', frame);
      }
    });
    this.client.on('textMessage', message => {
      if (message.invokerID === this.client.clientID()) return;
      this.emit('chat', {
        sender: message.invokerName, clientId: message.invokerID,
        text: message.message, scope: message.targetMode === 1 ? 'private' : message.targetMode === 3 ? 'server' : 'channel',
        channelId: this.view.snapshot(this.client.clientID()).channelId, time: Date.now(),
      });
    });
    this.client.on('disconnected', error => {
      if (!this.closed) this.emit('disconnect', error?.message || 'TeamSpeak 连接已断开');
    });
    this.client.on('kicked', reason => this.emit('disconnect', `已被移出服务器：${reason}`));
    const connecting = this.client.connect();
    // The pinned protocol library exposes its decoded-packet callback here.
    // Install after connect() initializes the transport, before the first UDP reply.
    const handler = this.client.handler;
    const receive = handler.onPacket;
    handler.onPacket = packet => { this.view.packet(packet); receive(packet); };
    await connecting;
    await this.client.waitConnected(AbortSignal.timeout(20_000));
    await Promise.race([
      this.view.welcome,
      new Promise((_, reject) => { this.welcomeTimer = setTimeout(() => reject(new Error('接收 TeamSpeak 频道超时')), 10_000); }),
    ]).finally(() => clearTimeout(this.welcomeTimer));
    if (this.closed) { await this.client.disconnect(); return; }
    this.nickname = this.view.clients.get(this.client.clientID())?.name || this.nickname;
    try { await this.client.execCommand('channelsubscribeall'); }
    catch { this.emit('notice', '服务器限制了频道订阅，成员列表仅显示你有权查看的频道。'); }
    this.encoder = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    this.encoder.setBitrate(32000);
  }

  async snapshot() {
    return this.view.snapshot(this.client.clientID());
  }

  async move(channelId, password) {
    await clientMove(this.client, this.client.clientID(), BigInt(channelId), password);
  }

  async chat(text) {
    await this.client.execCommand(buildCommand('sendtextmessage', { targetmode: '2', target: '0', msg: text }));
    return {
      sender: this.nickname, clientId: this.client.clientID(), text,
      scope: 'channel', channelId: this.view.snapshot(this.client.clientID()).channelId, time: Date.now(),
    };
  }

  async audioState(muted, deafened) {
    this.muted = muted;
    this.deafened = deafened;
    await this.client.execCommand(`clientupdate client_input_muted=${Number(muted)} client_output_muted=${Number(deafened)}`);
  }

  pcm(data) {
    if (!this.closed && !this.muted && this.encoder && data.length === 1920) {
      this.client.sendVoice(this.encoder.encode(data, 960), 4);
    }
  }

  async close() {
    this.closed = true;
    clearTimeout(this.welcomeTimer);
    if (this.encoder) { this.encoder.delete(); this.encoder = null; }
    await this.client?.disconnect();
  }
}
