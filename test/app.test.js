import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { loadSettings } from '../server/settings.js';

class FakeSession extends EventEmitter {
  constructor(config, key, nickname, target) { super(); Object.assign(this, { config, key, nickname, target }); }
  async connect() { this.channelId = '1'; }
  async snapshot() { return { selfId: 1, channelId: this.channelId, channels: [{ id: '1', parentId: '0', name: '大厅' }, { id: '2', parentId: '0', name: '游戏' }], clients: [] }; }
  async move(channelId, password) { if (channelId === '2' && password !== '秘密') throw new Error('invalid channel password'); this.channelId = channelId; }
  async chat(text) { if (text === '被拒绝') throw new Error('insufficient client permissions'); return { text, sender: '测试用户', channelId: this.channelId, scope: 'channel' }; }
  async audioState(muted, deafened) { Object.assign(this, { muted, deafened }); }
  pcm(data) { this.lastPcm = data; }
  async close() { this.closed = true; this.emit('closed'); }
}

async function setup(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tsweb-test-'));
  await writeFile(path.join(directory, 'index.html'), '<title>TSWeb</title>');
  const sessions = [];
  const config = { ...readConfig({}), distDir: directory, dataDir: directory, ...overrides };
  await loadSettings(config);
  const app = createApp(config, (...args) => { const session = new FakeSession(...args); sessions.push(session); return session; });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true }); });
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
  const messages = [];
  const events = new EventEmitter();
  socket.on('message', (data, binary) => { const value = binary ? Buffer.from(data) : JSON.parse(data); messages.push(value); events.emit('message'); });
  await once(socket, 'open');
  async function until(predicate) {
    const timeout = AbortSignal.timeout(3000);
    while (!messages.some(predicate)) await once(events, 'message', { signal: timeout });
    return messages.find(predicate);
  }
  function send(type, payload = {}) { socket.send(JSON.stringify({ type, ...payload })); }
  async function join(target = {}) { send('join', { id: 'join', identity: '11111111-1111-4111-8111-111111111111', nickname: '测试用户', password: overrides.webPassword || '', serverAddress: 'ts.example.com', ...target }); await until(message => message.type === 'ack' && message.id === 'join'); }
  return { origin, socket, messages, until, send, join, sessions, config };
}

test('管理密码保护网站设置，修改立即生效并在重启后保留', async t => {
  const { origin, config, join, send, until, socket } = await setup(t, { webPassword: '旧访问密码' });
  await join();
  const endpoint = `${origin}/api/settings`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer wrong-password' } })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'PUT', body: '{}' })).status, 401);
  const headers = { Authorization: `Bearer ${config.adminPassword}`, 'Content-Type': 'application/json' };
  assert.deepEqual(await (await fetch(endpoint, { headers })).json(), { siteName: 'TSWeb', webPassword: '旧访问密码', securityLevel: 8 });
  const values = { siteName: '朋友的语音网页', webPassword: '新的访问密码', securityLevel: 12 };
  const save = body => fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify(body) });
  assert.equal((await save({ ...values, securityLevel: 21 })).status, 400);
  assert.equal(config.securityLevel, 8);
  assert.equal((await save({ ...values, securityLevel: 8.5 })).status, 400);
  assert.equal((await save({ ...values, siteName: ' ' })).status, 400);
  const response = await save(values);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), values);
  const update = await until(message => message.type === 'site-config');
  assert.deepEqual(update, { type: 'site-config', siteName: values.siteName, passwordRequired: true });
  assert.equal(socket.readyState, WebSocket.OPEN);
  send('refresh', { id: 'still-connected' });
  await until(message => message.id === 'still-connected');
  const publicText = await (await fetch(`${origin}/api/config`)).text();
  assert.equal(publicText.includes(values.webPassword), false);
  assert.equal(publicText.includes(config.adminPassword), false);
  assert.equal(JSON.parse(publicText).siteName, values.siteName);

  const restored = { ...readConfig({ SERVER_NAME: '环境初始值', WEB_PASSWORD: '环境初始密码' }), dataDir: config.dataDir };
  await loadSettings(restored);
  assert.equal(restored.serverName, values.siteName);
  assert.equal(restored.webPassword, values.webPassword);
  assert.equal(restored.securityLevel, 12);
  assert.equal(restored.adminPassword, config.adminPassword);

  const next = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
  await once(next, 'open');
  const target = { type: 'join', identity: '22222222-2222-4222-8222-222222222222', nickname: '新的用户', serverAddress: 'ts.example.com' };
  let received = once(next, 'message');
  next.send(JSON.stringify({ ...target, password: '旧访问密码' }));
  assert.match(JSON.parse((await received)[0]).message, /密码/);
  received = once(next, 'message');
  next.send(JSON.stringify({ ...target, password: values.webPassword }));
  assert.equal(JSON.parse((await received)[0]).type, 'joined');
  next.close();

  assert.equal((await save({ ...values, webPassword: '' })).status, 200);
  assert.equal((await (await fetch(`${origin}/api/config`)).json()).passwordRequired, false);
});

test('页面、健康检查及配置只返回公开信息', async t => {
  const { origin } = await setup(t, { webPassword: '网页秘密' });
  assert.equal((await fetch(origin)).status, 200);
  assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { ok: true });
  const text = await (await fetch(`${origin}/api/config`)).text();
  assert.equal(text.includes('秘密'), false);
  assert.equal(JSON.parse(text).passwordRequired, true);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['passwordRequired', 'siteName']);
  assert.equal((await fetch(`${origin}/%2e%2e%2fpackage.json`)).status, 404);
});

test('访问密码和昵称不正确时不会建立 TeamSpeak 连接', async t => {
  const { send, until, sessions } = await setup(t, { webPassword: '秘密' });
  send('join', { id: 'bad', nickname: '测试用户', password: '错了' });
  assert.match((await until(message => message.id === 'bad')).message, /密码/);
  send('join', { id: 'short', nickname: '短', password: '秘密' });
  assert.match((await until(message => message.id === 'short')).message, /3–30/);
  assert.equal(sessions.length, 0);
});

test('频道切换遵守密码，消息等待服务器确认，音频双向转发', async t => {
  const { join, send, until, sessions, socket } = await setup(t);
  await join();
  send('move', { id: 'locked', channelId: '2' });
  assert.match((await until(message => message.id === 'locked')).message, /password/);
  assert.equal(sessions[0].channelId, '1');
  send('move', { id: 'moved', channelId: '2', password: '秘密' });
  await until(message => message.id === 'moved');
  assert.equal(sessions[0].channelId, '2');
  send('chat', { id: 'sent', text: '你好 <script> & 中文' });
  const chat = await until(message => message.type === 'chat');
  assert.equal(chat.text, '你好 <script> & 中文');
  assert.equal(chat.channelId, '2');
  send('chat', { id: 'denied', text: '被拒绝' });
  assert.match((await until(message => message.id === 'denied')).message, /permissions/);
  send('audio-state', { id: 'muted', muted: true, deafened: false });
  await until(message => message.id === 'muted');
  assert.equal(sessions[0].muted, true);
  const pcm = Buffer.alloc(1920, 7);
  socket.send(pcm);
  // A following request is ordered after the binary message on the socket.
  send('refresh', { id: 'after-pcm' });
  await until(message => message.id === 'after-pcm');
  assert.deepEqual(sessions[0].lastPcm, pcm);
  sessions[0].emit('voice', { clientId: 42, codec: 4, data: Buffer.from([1, 2, 3]) });
  const frame = await until(Buffer.isBuffer);
  assert.deepEqual([...frame], [0, 42, 4, 1, 2, 3]);
  const serverClosed = once(sessions[0], 'closed');
  socket.close();
  await once(socket, 'close');
  await serverClosed;
  assert.equal(sessions[0].closed, true);
});

test('同一浏览器身份不重复占用 TeamSpeak 连接', async t => {
  const { origin, join } = await setup(t);
  await join();
  const second = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
  await once(second, 'open');
  const response = once(second, 'message');
  second.send(JSON.stringify({ type: 'join', id: 'duplicate', identity: '11111111-1111-4111-8111-111111111111', nickname: '第二个标签', serverAddress: 'ts.example.com' }));
  assert.match(JSON.parse((await response)[0]).message, /标签页/);
  second.close();
});

test('每位用户独立指定 IP、域名、端口和密码，退出后可以更换服务器', async t => {
  const { origin, join, send, until, sessions } = await setup(t);
  await join({ serverAddress: '192.0.2.10:10000', serverPassword: '第一台密码' });
  const second = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
  await once(second, 'open');
  const joined = once(second, 'message');
  second.send(JSON.stringify({ type: 'join', id: 'second', identity: '22222222-2222-4222-8222-222222222222', nickname: '另一位用户', serverAddress: 'voice.example.com:20000', serverPassword: '第二台密码' }));
  await joined;
  assert.deepEqual(sessions[0].target, { host: '192.0.2.10', port: 10000, explicitPort: true, address: '192.0.2.10:10000', password: '第一台密码' });
  assert.deepEqual(sessions[1].target, { host: 'voice.example.com', port: 20000, explicitPort: true, address: 'voice.example.com:20000', password: '第二台密码' });
  send('leave', { id: 'left' });
  await until(message => message.id === 'left');
  assert.equal(sessions[0].closed, true);
  const reconnect = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
  await once(reconnect, 'open');
  const rejoined = once(reconnect, 'message');
  reconnect.send(JSON.stringify({ type: 'join', id: 'rejoin', identity: '11111111-1111-4111-8111-111111111111', nickname: '测试用户', serverAddress: 'other.example.com' }));
  assert.equal(JSON.parse((await rejoined)[0]).type, 'joined');
  assert.equal(sessions[2].target.address, 'other.example.com');
  assert.equal(sessions[2].target.password, '');
  second.close(); reconnect.close();
});
