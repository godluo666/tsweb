import { EventEmitter } from 'node:events';
import { setDefaultResultOrder } from 'node:dns';
import { createSocket } from 'node:dgram';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, generateIdentity, identityFromString, clientMove, noopLogger } from '@honeybbq/teamspeak-client';
import { buildCommand } from '@honeybbq/teamspeak-client/command';
import OpusScript from 'opusscript';
import { ServerView } from './view.js';
import { ConnectionStats } from './connection-stats.js';

// Docker's default network has IPv4 connectivity; IPv6 literals still resolve as IPv6.
setDefaultResultOrder('ipv4first');

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
  constructor(config, key, nickname, target) {
    super();
    Object.assign(this, { config, key, nickname, target, muted: false, deafened: false, closed: false });
    this.view = new ServerView(() => this.emit('change'));
    this.statistics = new ConnectionStats();
  }

  async connect() {
    const identity = await loadIdentity(this.config, this.key);
    if (this.closed) return;
    const options = {
      serverPassword: this.target.password,
      logger: noopLogger,
      socketFactory: family => {
        const socket = createSocket(family === 6 ? 'udp6' : 'udp4');
        const send = socket.send.bind(socket);
        socket.send = (data, ...args) => {
          // C2S datagrams carry the packet ID after the 8-byte authentication tag.
          if (data.length >= 13 && (data[12] & 15) === 4) this.statistics.sent(data.readUInt16BE(8));
          return send(data, ...args);
        };
        return socket;
      },
    };
    // An explicit port takes precedence over the domain's SRV/TSDNS records.
    if (this.target.explicitPort) options.resolver = { resolve: async () => [{ addr: this.target.address }] };
    this.client = new Client(identity, this.target.address, this.nickname, options);
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
    handler.onPacket = packet => {
      if ((packet.typeFlagged & 15) === 5 && packet.data.length >= 2) {
        this.statistics.received((packet.data[0] << 8) | packet.data[1]);
      }
      this.view.packet(packet);
      receive(packet);
    };
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
    handler.sendPacket(4, new Uint8Array(0), 128);
  }

  async snapshot() {
    return this.view.snapshot(this.client.clientID());
  }

  connectionStats() {
    return this.statistics.snapshot();
  }

  async channelInfo(channelId) {
    if (!this.view.channels.has(channelId)) throw new Error('频道不存在或不可见');
    const rows = await this.client.execCommandWithResponse(`channelinfo cid=${channelId}`, 5000);
    if (!rows.length) throw new Error('服务器未返回频道信息');
    this.view.command('notifychanneledited', { ...rows[0], cid: channelId });
    return { ...this.view.channels.get(channelId), clients: [...this.view.clients.values()].filter(client => client.channelId === channelId && client.type === 0).length };
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
