import './style.css';
import { icon } from './icons.js';
import { VoiceAudio } from './audio.js';
import { mountSettings } from './settings.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const state = { connected: false, connecting: false, serverAddress: '', nickname: '', selfId: 0, channelId: '', channels: [], clients: [], messages: [], muted: true, deafened: false, speaking: [], config: null, stats: null };
let socket, audio, requestId = 0;
const pending = new Map();
let toastTimer, statsTimer;
let savedVolumes;
try { savedVolumes = JSON.parse(localStorage.getItem('tsweb.userVolumes') || '{}'); } catch { savedVolumes = {}; }
const sessionVolumes = new Map();
let detailInfo = null;

const codecName = value => ({ 0: 'Speex Narrowband', 1: 'Speex Wideband', 2: 'Speex Ultra-Wideband', 3: 'CELT Mono', 4: 'Opus Voice', 5: 'Opus Music' }[value] || '未知编码');
const volumeKey = client => `${state.serverAddress}\n${client.uid || `session:${client.id}`}`;
function userVolume(client) {
  const key = volumeKey(client);
  return sessionVolumes.get(key) ?? (client.uid ? savedVolumes[key] : undefined) ?? 100;
}

function setUserVolume(client, value) {
  const volume = Math.max(0, Math.min(200, Number(value)));
  const key = volumeKey(client);
  sessionVolumes.set(key, volume);
  if (client.uid) {
    if (volume === 100) delete savedVolumes[key]; else savedVolumes[key] = volume;
    localStorage.setItem('tsweb.userVolumes', JSON.stringify(savedVolumes));
  }
  audio?.setUserVolume(client.id, volume / 100);
  const member = $(`[data-member="${client.id}"]`);
  if (member) {
    member.querySelector('[data-user-volume]').value = volume;
    member.querySelector('[data-volume-reset]').textContent = `${volume}%`;
    member.classList.toggle('silenced', volume === 0);
  }
}

$('#app').innerHTML = `
  <div class="workspace">
    <aside class="rail" aria-label="应用"><a class="app-mark" href="/" aria-label="TSWeb 首页">${icon('headset')}</a><span class="rail-line"></span><div class="server-dot" title="TeamSpeak">TS</div></aside>
    <aside class="sidebar" id="sidebar">
      <div class="server-heading"><div><span class="eyebrow">服务器</span><h1 id="server-name">TeamSpeak</h1></div><span class="server-badge">TS</span><button id="close-menu" class="icon-button mobile-menu" aria-label="关闭频道列表">${icon('close')}</button></div>
      <div class="channel-label"><span>语音频道</span><button class="icon-button" id="refresh" aria-label="刷新频道" title="刷新频道">${icon('refresh')}</button></div>
      <nav id="channels" class="channels" aria-label="TeamSpeak 频道"><div class="sidebar-empty">连接服务器后<br>在这里选择频道</div></nav>
      <div class="connection-panel"><div class="connection-title"><span class="status-dot" id="status-dot"></span><span id="status-label">尚未连接</span></div><div id="connection-detail">未选择服务器</div></div>
      <div class="user-panel"><div class="avatar self-avatar" id="self-avatar">U</div><div class="user-meta"><strong id="self-name">未连接</strong><span id="self-detail">浏览器客户端</span></div><button class="icon-button leave-button" id="leave" aria-label="断开连接" title="断开连接" disabled>${icon('leave')}</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><button class="icon-button mobile-menu" id="menu" aria-label="打开频道列表">${icon('menu')}</button><span class="channel-symbol">${icon('volume')}</span><div class="topbar-title"><strong id="channel-name">TeamSpeak</strong><span id="channel-subtitle">未选择频道</span></div><div class="topbar-count" title="可见在线成员">${icon('users')}<span id="online-count">0</span></div><button id="channel-info" class="icon-button" title="频道信息" aria-label="查看频道信息" aria-expanded="false" disabled>${icon('info')}</button></header>
      <section class="voice-stage" aria-label="当前频道成员">
        <div class="stage-heading"><div><span class="eyebrow">当前频道</span><h2 id="stage-title">尚未连接</h2><p id="stage-description">连接 TeamSpeak 后显示频道成员。</p></div><span class="live-tag" id="live-tag"><span></span> 未连接</span></div>
        <div id="members" class="members"><div class="stage-empty">${icon('users')}<span>暂无频道成员</span></div></div>
        <div class="voice-controls"><div class="control-buttons"><button id="mic" class="control-button muted" disabled aria-label="开启麦克风">${icon('micOff')}<span>开启麦克风</span></button><button id="deafen" class="control-button" disabled aria-label="关闭收听">${icon('headset')}<span>正在收听</span></button><span class="controls-divider"></span><label class="volume-label" title="收听音量">${icon('volume')}<input id="volume" type="range" min="0" max="150" value="100" aria-label="收听音量"><span id="volume-value">100%</span></label></div><span class="audio-hint" id="audio-hint">进入后默认静音</span></div>
      </section>
      <section class="chat-panel" aria-label="频道文字聊天"><div class="chat-heading"><h2>${icon('chat')}频道消息</h2><span>同步至 TeamSpeak 频道</span></div><div id="messages" class="messages" role="log" aria-live="polite"></div><form id="chat-form" class="chat-form"><label class="sr-only" for="message-input">频道消息</label><input id="message-input" autocomplete="off" placeholder="连接后发送消息" disabled><button id="send" type="submit" aria-label="发送消息" disabled>${icon('send')}</button></form><div class="chat-footer"><span><kbd>Enter</kbd> 发送</span><span>消息仅保留在本次会话</span></div></section>
      <footer class="app-footer" aria-label="连接质量"><span class="network-metric" title="浏览器与网页服务之间的往返延迟">${icon('globe')}网页延迟 <strong id="web-latency">—</strong></span><span class="network-metric" title="网页服务与 TeamSpeak 之间的 UDP 往返延迟">${icon('signal')}TS 延迟 <strong id="ts-latency">—</strong></span><span class="network-metric" title="最近 60 秒 TS UDP 探测丢包率；5 秒内未收到响应计为丢失">探测丢包 <strong id="packet-loss">—</strong></span></footer>
    </main>
    <aside class="details-panel" id="channel-details" aria-labelledby="details-title" hidden><div class="details-heading"><h2 id="details-title">频道信息</h2><button class="icon-button" id="close-channel-info" aria-label="关闭频道信息">${icon('close')}</button></div><div id="channel-info-body"></div></aside>
  </div>
  <div class="connect-layer" id="connect-layer"><section class="connect-card" aria-labelledby="connect-title"><div class="connect-logo">${icon('headset')}<span>TSWeb</span></div><h2 id="connect-title">连接 TeamSpeak</h2><p class="connect-description">输入服务器 IP 或域名。</p><form id="connect-form"><label for="server-address">服务器地址</label><input id="server-address" type="text" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ts.example.com:9987" aria-describedby="server-address-hint" required><p id="server-address-hint" class="field-hint">默认端口 9987，支持自定义端口</p><label for="nickname">昵称</label><input id="nickname" autocomplete="nickname" placeholder="输入你的昵称" required minlength="3" maxlength="60"><div class="connect-field"><label for="server-password">服务器密码 <span class="optional-label">可选</span></label><input id="server-password" type="password" autocomplete="off" placeholder="TeamSpeak 服务器密码"></div><div id="password-field" hidden><label for="web-password">网页访问密码</label><input id="web-password" type="password" autocomplete="current-password" placeholder="部署者设置的访问密码"></div><p id="connect-error" class="form-error" role="alert"></p><button class="primary-button" id="connect" type="submit"><span>连接服务器</span>${icon('arrow')}</button></form><p class="connect-note">${icon('micOff')} 连接后默认关闭麦克风</p></section></div>
  <dialog id="password-dialog"><form id="channel-password-form"><div class="dialog-heading"><h2>${icon('lock')}频道密码</h2><button type="button" class="icon-button" id="cancel-password" aria-label="取消">${icon('close')}</button></div><p id="password-channel"></p><label for="channel-password" class="sr-only">频道密码</label><input id="channel-password" type="password" autocomplete="off" placeholder="输入频道密码" required><button class="primary-button" type="submit">进入频道 ${icon('arrow')}</button></form></dialog>
  <div id="toast" class="toast" role="alert" hidden></div>`;

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

function applyPublicConfig(config) {
  state.config = config;
  $('#password-field').hidden = !config.passwordRequired;
  $('#web-password').required = config.passwordRequired;
  $('.connect-logo>span').textContent = config.siteName;
  document.title = `${config.siteName} · TeamSpeak 网页客户端`;
  renderStatus();
}

async function loadPublicConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('无法读取服务器配置');
  applyPublicConfig(await response.json());
}

mountSettings(applyPublicConfig, notify);

function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) { reject(new Error('连接已断开')); return; }
    const id = String(++requestId);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(type === 'join' ? '连接超时，请检查 TeamSpeak 地址、UDP 端口与服务器密码' : '请求超时，请重试')); }, type === 'join' ? 35_000 : 12_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type, id, ...payload }));
  });
}

function orderedChannels() {
  const result = [];
  function walk(parentId, depth) {
    const remaining = state.channels.filter(channel => channel.parentId === parentId);
    let previous = '0';
    while (remaining.length) {
      const index = remaining.findIndex(channel => channel.order === previous);
      const [channel] = remaining.splice(index < 0 ? 0 : index, 1);
      result.push({ ...channel, depth });
      previous = channel.id;
      walk(channel.id, depth + 1);
    }
  }
  walk('0', 0);
  return result;
}

function renderChannels() {
  if (!state.connected) { $('#channels').innerHTML = '<div class="sidebar-empty">连接服务器后<br>在这里选择频道</div>'; return; }
  $('#channels').innerHTML = orderedChannels().map(channel => {
    const clients = state.clients.filter(client => client.channelId === channel.id);
    return `<div class="channel-group"><div class="channel-line"><button class="channel-row ${channel.id === state.channelId ? 'active' : ''}" data-channel="${escape(channel.id)}" style="--depth:${channel.depth}" title="进入 ${escape(channel.name)}">${icon(channel.hasPassword ? 'lock' : 'volume')}<span>${escape(channel.name)}</span><small>${clients.length || ''}</small></button><button class="icon-button channel-info-trigger" data-info="${escape(channel.id)}" aria-label="查看 ${escape(channel.name)} 的频道信息" title="频道信息">${icon('info')}</button></div>${clients.map(client => `<div class="channel-client ${state.speaking.includes(client.id) ? 'speaking' : ''}" data-client="${client.id}" style="--depth:${channel.depth}"><span class="tiny-avatar" style="--avatar-hue:${client.id * 47 % 360}">${escape([...client.name][0])}</span><span>${escape(client.name)}</span>${client.id === state.selfId ? '<small>你</small>' : ''}<i class="speaking-light"></i></div>`).join('')}</div>`;
  }).join('') || '<div class="sidebar-empty">没有可见频道</div>';
}

function renderMembers() {
  if (!state.connected) { $('#members').innerHTML = `<div class="stage-empty">${icon('users')}<span>暂无频道成员</span></div>`; $('#online-count').textContent = '0'; return; }
  const members = state.clients.filter(client => client.channelId === state.channelId);
  $('#online-count').textContent = state.clients.length;
  const container = $('#members');
  const ids = new Set(members.map(client => String(client.id)));
  for (const node of [...container.children]) if (!ids.has(node.dataset.member)) node.remove();
  for (const client of members) {
    const self = client.id === state.selfId;
    const muted = self ? state.muted : client.muted;
    let node = container.querySelector(`[data-member="${client.id}"]`);
    if (!node) {
      node = document.createElement('article');
      node.dataset.member = client.id;
      node.innerHTML = `<div class="member-top"><div class="member-avatar"><span class="member-initial"></span><span class="member-status"></span></div><div class="member-meta"><strong></strong><span></span></div></div>${self ? '<div class="member-gain self-label">当前用户</div>' : `<div class="member-gain">${icon('volume')}<input type="range" min="0" max="200" step="1" data-user-volume="${client.id}"><button type="button" data-volume-reset="${client.id}" title="恢复为 100%"></button></div>`}`;
      container.append(node);
    }
    node.className = `member${state.speaking.includes(client.id) ? ' speaking' : ''}${!self && userVolume(client) === 0 ? ' silenced' : ''}`;
    node.style.setProperty('--avatar-hue', client.id * 47 % 360);
    node.querySelector('.member-initial').textContent = [...client.name][0] || '?';
    node.querySelector('.member-status').innerHTML = icon(client.deafened ? 'earOff' : muted ? 'micOff' : 'mic');
    node.querySelector('.member-meta strong').textContent = client.name;
    node.querySelector('.member-meta strong').title = client.name;
    node.querySelector('.member-meta>span').textContent = `${self ? '你 · ' : ''}${client.deafened ? '已关闭收听' : muted ? '麦克风关闭' : '麦克风开启'}`;
    if (!self) {
      const slider = node.querySelector('[data-user-volume]');
      slider.value = userVolume(client);
      slider.setAttribute('aria-label', `${client.name}的收听音量`);
      node.querySelector('[data-volume-reset]').textContent = `${userVolume(client)}%`;
    }
  }
  if (!members.length) container.innerHTML = '<div class="stage-empty">正在同步频道成员</div>';
}

function renderConnectionStats() {
  const stats = state.stats;
  const milliseconds = value => `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  $('#web-latency').textContent = stats?.webRttMs != null ? milliseconds(stats.webRttMs) : '—';
  $('#ts-latency').textContent = stats?.tsRttMs != null ? milliseconds(stats.tsRttMs) : '—';
  $('#packet-loss').textContent = stats?.packetLossPercent != null ? `${stats.packetLossPercent.toFixed(1)}%` : '—';
  $('#packet-loss').title = stats ? `最近 ${stats.windowSeconds} 秒，${stats.probes} 次已完成探测` : '连接后开始统计';
}

async function updateConnectionStats() {
  const connection = socket;
  const started = performance.now();
  try {
    const response = await request('ping');
    if (socket !== connection || !state.connected) return;
    state.stats = { ...response.stats, webRttMs: performance.now() - started };
    renderConnectionStats();
  } catch {
    if (socket !== connection || !state.connected) return;
    state.stats = null;
    renderConnectionStats();
  } finally {
    if (socket === connection && state.connected) statsTimer = setTimeout(updateConnectionStats, 5000);
  }
}

function renderChannelInfo(channel, loading = false) {
  const count = state.clients.filter(client => client.channelId === channel.id).length;
  const capacity = channel.unlimitedClients || channel.maxClients === -1 ? '不限' : channel.maxClients ?? '—';
  const rows = [
    ['频道 ID', channel.id], ['频道人数', `${count} / ${capacity}`],
    ['频道类型', channel.permanent ? '永久频道' : channel.semiPermanent ? '半永久频道' : channel.permanent === false ? '临时频道' : '—'],
    ['音频编码', codecName(channel.codec)], ['音频质量', channel.quality == null ? '—' : `${channel.quality} / 10`],
    ['进入密码', channel.hasPassword ? '需要密码' : '无需密码'], ['所需发言权限', channel.neededTalkPower ?? '—'],
  ];
  $('#channel-info-body').innerHTML = `<div class="detail-channel-icon">${icon(channel.hasPassword ? 'lock' : 'volume')}</div><h3>${escape(channel.name)}</h3>${channel.isDefault ? '<span class="detail-badge">默认频道</span>' : ''}<dl class="detail-properties">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><section class="detail-section"><h4>频道主题</h4><p>${escape(channel.topic || (loading ? '正在读取…' : '未设置主题'))}</p></section><section class="detail-section"><h4>频道描述</h4><p class="channel-description">${escape(channel.description || (loading ? '正在读取…' : '未设置描述'))}</p></section>`;
}

async function openChannelInfo(channelId) {
  const channel = state.channels.find(item => item.id === channelId);
  if (!channel) return;
  detailInfo = null;
  $('#channel-details').dataset.channel = channelId;
  $('#channel-details').hidden = false;
  $('#channel-info').setAttribute('aria-expanded', 'true');
  renderChannelInfo(channel, true);
  try {
    const response = await request('channel-info', { channelId });
    if ($('#channel-details').hidden || $('#channel-details').dataset.channel !== channelId) return;
    detailInfo = response.channel;
    renderChannelInfo(detailInfo);
  } catch (error) {
    if ($('#channel-details').hidden || $('#channel-details').dataset.channel !== channelId) return;
    $('#channel-info-body').insertAdjacentHTML('beforeend', `<p class="form-error">${escape(error.message)}</p>`);
  }
}

function renderMessages() {
  const messages = state.messages.filter(message => message.scope !== 'channel' || message.channelId === state.channelId);
  if (!messages.length) {
    $('#messages').innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">' + icon('chat') + '</div><h3>暂无消息</h3><p>发送消息后将同步至当前频道。</p></div>';
    return;
  }
  $('#messages').innerHTML = messages.map(message => `<article class="message"><span class="message-avatar" style="--avatar-hue:${message.clientId * 47 % 360}">${escape([...message.sender][0])}</span><div class="message-body"><div class="message-meta"><strong>${escape(message.sender)}</strong>${message.scope !== 'channel' ? `<span class="message-scope">${message.scope === 'private' ? '私聊' : '服务器'}</span>` : ''}<time>${new Date(message.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escape(message.text)}</p></div></article>`).join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function renderStatus() {
  const channel = state.channels.find(channel => channel.id === state.channelId);
  const supportedCodec = !channel || [4, 5].includes(channel.codec);
  $('#connect-layer').hidden = state.connected;
  $('#connect').disabled = state.connecting || !state.config;
  $('#connect').innerHTML = state.connecting ? '<span class="spinner"></span><span>正在连接…</span>' : `<span>连接服务器</span>${icon('arrow')}`;
  $('#status-label').textContent = state.connected ? '语音已连接' : state.connecting ? '正在连接' : '尚未连接';
  $('#status-dot').classList.toggle('ready', state.connected);
  $('#server-name').textContent = state.connected ? state.serverAddress : state.config?.siteName || 'TSWeb';
  $('#server-name').title = state.connected ? state.serverAddress : '';
  $('#connection-detail').textContent = channel?.name || '未选择服务器';
  $('#channel-name').textContent = channel?.name || 'TeamSpeak';
  $('#stage-title').textContent = state.connected ? channel?.name || '已加入服务器' : '尚未连接';
  $('#stage-description').textContent = state.connected ? supportedCodec ? `${state.clients.filter(client => client.channelId === state.channelId).length} 位成员 · ${codecName(channel?.codec)}` : '此频道使用旧音频编码，请在 TS 中改为 Opus Voice 或 Opus Music。' : '连接 TeamSpeak 后显示频道成员。';
  $('#channel-subtitle').textContent = state.connected ? state.serverAddress : '未选择频道';
  $('#live-tag').innerHTML = `<span></span>${state.connected ? '已连接' : '未连接'}`;
  $('#live-tag').classList.toggle('connected', state.connected);
  for (const id of ['mic', 'deafen', 'leave', 'message-input', 'send', 'refresh', 'channel-info']) $(`#${id}`).disabled = !state.connected;
  $('#mic').disabled = !state.connected || !supportedCodec;
  $('#self-name').textContent = state.connected ? state.nickname : '未连接';
  $('#self-avatar').textContent = state.connected ? [...state.nickname][0] : 'U';
  $('#self-detail').textContent = state.connected ? state.muted ? '麦克风已关闭' : '麦克风已开启' : '浏览器客户端';
  $('#mic').innerHTML = `${icon(state.muted ? 'micOff' : 'mic')}<span>${state.muted ? '开启麦克风' : '麦克风已开'}</span>`;
  $('#mic').classList.toggle('muted', state.muted);
  $('#mic').setAttribute('aria-label', state.muted ? '开启麦克风' : '关闭麦克风');
  $('#mic').setAttribute('aria-pressed', String(!state.muted));
  $('#deafen').innerHTML = `${icon(state.deafened ? 'earOff' : 'headset')}<span>${state.deafened ? '收听已关' : '正在收听'}</span>`;
  $('#deafen').setAttribute('aria-label', state.deafened ? '开启收听' : '关闭收听');
  $('#deafen').setAttribute('aria-pressed', String(state.deafened));
  $('#deafen').classList.toggle('muted', state.deafened);
  $('#message-input').placeholder = state.connected ? `发消息到 ${channel?.name || '当前频道'}…` : '连接后，发送一条消息…';
  $('#audio-hint').textContent = state.connected ? state.muted ? '你的麦克风已静音' : '回声消除 · 自动降噪' : '进入后默认静音';
}

function onSpeaking(ids) {
  state.speaking = ids;
  for (const element of document.querySelectorAll('[data-member]')) element.classList.toggle('speaking', ids.includes(Number(element.dataset.member)));
  for (const element of document.querySelectorAll('[data-client]')) element.classList.toggle('speaking', ids.includes(Number(element.dataset.client)));
}

function disconnected(message) {
  const wasConnected = state.connected;
  state.connected = false;
  state.connecting = false;
  state.muted = true;
  state.deafened = false;
  state.channels = []; state.clients = []; state.messages = [];
  state.channelId = ''; state.selfId = 0; state.speaking = [];
  state.stats = null;
  clearTimeout(statsTimer);
  sessionVolumes.clear();
  $('#channel-details').hidden = true;
  $('#channel-info').setAttribute('aria-expanded', 'false');
  detailInfo = null;
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(message || '连接已断开')); }
  pending.clear();
  void audio?.close();
  audio = null;
  renderStatus();
  renderChannels(); renderMembers(); renderMessages();
  renderConnectionStats();
  if (wasConnected) $('#connect-error').textContent = message || '通话已结束，可以重新连接。';
}

async function connect(event) {
  event.preventDefault();
  if (state.connecting) return;
  const nickname = $('#nickname').value.trim();
  const serverAddress = $('#server-address').value.trim();
  if (!serverAddress) { $('#connect-error').textContent = '请填写服务器的 IP 或域名'; return; }
  if ([...nickname].length < 3 || [...nickname].length > 30) { $('#connect-error').textContent = '昵称需要 3–30 个字符'; return; }
  state.connecting = true;
  $('#connect-error').textContent = '';
  renderStatus();
  try {
    audio = new VoiceAudio(onSpeaking, notify);
    audio.setOutput(Number($('#volume').value) / 100, false);
    await audio.prepare();
    let identity = localStorage.getItem('tsweb.identity');
    if (!identity) { identity = crypto.randomUUID(); localStorage.setItem('tsweb.identity', identity); }
    localStorage.setItem('tsweb.nickname', nickname);
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.binaryType = 'arraybuffer';
    socket.onmessage = event => {
      if (typeof event.data !== 'string') { void audio?.receive(event.data).catch(error => notify(error.message)); return; }
      const message = JSON.parse(event.data);
      if (message.type === 'ack' || (message.type === 'error' && message.id)) {
        const entry = pending.get(message.id);
        if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.type === 'ack' ? entry.resolve(message) : entry.reject(new Error(message.message)); }
      } else if (message.type === 'error') notify(message.message);
      if (message.type === 'notice') notify(message.message);
      if (message.type === 'site-config') applyPublicConfig({ siteName: message.siteName, passwordRequired: message.passwordRequired });
      if (message.type === 'joined') {
        state.connected = true; state.connecting = false; state.nickname = message.nickname;
        state.serverAddress = message.serverAddress;
        localStorage.setItem('tsweb.server', message.serverAddress);
        $('#server-address').value = message.serverAddress;
        $('#server-password').value = '';
        renderStatus();
      }
      if (message.type === 'snapshot') {
        const changed = state.channelId !== message.channelId;
        Object.assign(state, { selfId: message.selfId, channelId: message.channelId, channels: message.channels, clients: message.clients });
        if (audio) audio.selfId = message.selfId;
        if (changed) audio?.reset();
        audio?.syncUsers(state.clients);
        for (const client of state.clients) if (client.id !== state.selfId) audio?.setUserVolume(client.id, userVolume(client) / 100);
        renderChannels(); renderMembers(); renderStatus(); renderMessages();
        if (!$('#channel-details').hidden && detailInfo) {
          const channel = state.channels.find(item => item.id === detailInfo.id);
          if (channel) { detailInfo = { ...detailInfo, ...channel }; renderChannelInfo(detailInfo); }
          else $('#channel-info-body').innerHTML = '<p class="form-error">频道已删除或不可见。</p>';
        }
      }
      if (message.type === 'chat') { state.messages.push(message); state.messages = state.messages.slice(-200); renderMessages(); }
      if (message.type === 'disconnected') { $('#connect-error').textContent = message.message; socket.close(); }
    };
    socket.onclose = () => disconnected($('#connect-error').textContent);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('无法连接网页服务，请检查网络')), 10_000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('无法连接网页服务，请检查网络')); };
    });
    await request('join', { nickname, identity, serverAddress, serverPassword: $('#server-password').value, password: $('#web-password').value });
    await request('audio-state', { muted: true, deafened: false });
    void updateConnectionStats();
  } catch (error) {
    $('#connect-error').textContent = error.message;
    socket?.close();
    disconnected(error.message);
    try { await loadPublicConfig(); } catch { /* Keep the connection error visible. */ }
  }
}

$('#connect-form').addEventListener('submit', connect);
$('#nickname').value = localStorage.getItem('tsweb.nickname') || '';
$('#server-address').value = localStorage.getItem('tsweb.server') || '';
$('#volume').value = localStorage.getItem('tsweb.volume') ?? '100';
$('#volume-value').textContent = `${$('#volume').value}%`;
$('#leave').onclick = async () => {
  $('#leave').disabled = true;
  $('#connect-error').textContent = '已离开服务器，可以填写另一个地址重新连接。';
  try { await request('leave'); }
  catch (error) { notify(error.message); }
  finally { socket?.close(); }
};
$('#menu').onclick = () => $('#sidebar').classList.toggle('mobile-open');
$('#close-menu').onclick = () => $('#sidebar').classList.remove('mobile-open');
$('#refresh').onclick = () => request('refresh').catch(error => notify(error.message));
$('#channels').onclick = async event => {
  const info = event.target.closest('[data-info]');
  if (info) { void openChannelInfo(info.dataset.info); $('#sidebar').classList.remove('mobile-open'); return; }
  const channel = event.target.closest('[data-channel]');
  if (!channel) return;
  if (channel.dataset.channel === state.channelId) { $('#sidebar').classList.remove('mobile-open'); return; }
  try { await request('move', { channelId: channel.dataset.channel }); $('#sidebar').classList.remove('mobile-open'); }
  catch (error) {
    if (/password|密码|3329/i.test(error.message)) {
      $('#password-dialog').dataset.channel = channel.dataset.channel;
      $('#password-channel').textContent = channel.textContent.trim();
      $('#channel-password').value = '';
      $('#password-dialog').showModal();
    } else notify(error.message);
  }
};
$('#channel-info').onclick = () => openChannelInfo(state.channelId);
$('#close-channel-info').onclick = () => { $('#channel-details').hidden = true; $('#channel-info').setAttribute('aria-expanded', 'false'); };
$('#members').oninput = event => {
  if (!event.target.matches('[data-user-volume]')) return;
  const client = state.clients.find(item => item.id === Number(event.target.dataset.userVolume));
  if (client) setUserVolume(client, event.target.value);
};
$('#members').onclick = event => {
  const button = event.target.closest('[data-volume-reset]');
  if (!button) return;
  const client = state.clients.find(item => item.id === Number(button.dataset.volumeReset));
  if (client) setUserVolume(client, 100);
};
$('#cancel-password').onclick = () => $('#password-dialog').close();
$('#channel-password-form').onsubmit = async event => {
  event.preventDefault();
  try {
    await request('move', { channelId: $('#password-dialog').dataset.channel, password: $('#channel-password').value });
    $('#password-dialog').close(); $('#sidebar').classList.remove('mobile-open');
  } catch (error) { notify(error.message); }
};
$('#mic').onclick = async () => {
  $('#mic').disabled = true;
  try {
    if (state.muted) {
      await audio.startMicrophone(buffer => { if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 16000) socket.send(buffer); });
      try { await request('audio-state', { muted: false, deafened: state.deafened }); }
      catch (error) { audio.setMuted(true); throw error; }
      state.muted = false;
    } else {
      audio.setMuted(true);
      state.muted = true;
      await request('audio-state', { muted: true, deafened: state.deafened });
    }
  } catch (error) { notify(error.name === 'NotAllowedError' ? '请允许浏览器使用麦克风，再点击开启。' : error.message); }
  renderStatus(); renderMembers();
};
$('#deafen').onclick = async () => {
  const next = !state.deafened;
  try {
    await request('audio-state', { muted: state.muted, deafened: next });
    state.deafened = next;
    audio.setOutput(Number($('#volume').value) / 100, next);
    audio.reset();
    renderStatus();
  } catch (error) { notify(error.message); }
};
$('#volume').oninput = () => {
  $('#volume-value').textContent = `${$('#volume').value}%`;
  localStorage.setItem('tsweb.volume', $('#volume').value);
  audio?.setOutput(Number($('#volume').value) / 100, state.deafened);
};
$('#chat-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  if (!text) return;
  $('#send').disabled = true;
  try { await request('chat', { text }); if (input.value.trim() === text) input.value = ''; }
  catch (error) { notify(error.message); }
  $('#send').disabled = !state.connected;
  input.focus();
};
window.addEventListener('pagehide', () => socket?.close());

try {
  await loadPublicConfig();
} catch (error) { $('#connect-error').textContent = error.message; }
renderStatus();
