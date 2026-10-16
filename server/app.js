import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { TeamSpeakSession } from './teamspeak.js';
import { parseServerAddress } from './address.js';
import { saveSettings } from './settings.js';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createApp(config, sessionFactory = (...args) => new TeamSpeakSession(...args)) {
  const publicConfig = () => ({ siteName: config.serverName, passwordRequired: Boolean(config.webPassword) });
  const settings = () => ({ siteName: config.serverName, webPassword: config.webPassword, securityLevel: config.securityLevel });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/settings') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (!config.adminPassword || req.headers.authorization !== `Bearer ${config.adminPassword}`) {
        res.writeHead(401).end(JSON.stringify({ error: '管理密码不正确' })); return;
      }
      if (req.method === 'GET') { res.end(JSON.stringify(settings())); return; }
      if (req.method !== 'PUT') { res.writeHead(405).end(); return; }
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await saveSettings(config, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const message = JSON.stringify({ type: 'site-config', ...publicConfig() });
        for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN) socket.send(message);
        res.end(JSON.stringify(settings()));
      } catch (error) {
        const invalid = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError;
        if (!invalid) console.error('无法保存网站设置:', error.message);
        res.writeHead(invalid ? 400 : 500).end(JSON.stringify({ error: invalid ? error.message : '无法保存设置，请检查数据卷是否可写' }));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end(); return;
    }
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true })); return;
    }
    if (pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(publicConfig())); return;
    }
    try {
      const file = path.resolve(config.distDir, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
      if (!file.startsWith(`${config.distDir}${path.sep}`)) { res.writeHead(404).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('Not found'); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const identities = new Set();
  const cleanups = new Set();
  wss.on('connection', socket => {
    let session, key, connected = false, closed = false, refreshTimer, refreshing = false;
    let queue = Promise.resolve();
    const send = payload => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };
    const refresh = async () => {
      if (!connected || closed || refreshing) return;
      refreshing = true;
      try { send({ type: 'snapshot', ...await session.snapshot() }); }
      catch (error) { send({ type: 'error', message: `无法更新频道：${error.message}` }); }
      finally { refreshing = false; }
    };
    const scheduleRefresh = () => {
      if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; queue = queue.then(refresh); }, 300);
    };
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      connected = false;
      clearTimeout(refreshTimer);
      cleanups.delete(cleanup);
      await session?.close().catch(error => console.error('TeamSpeak 断开失败:', error.message));
      if (key) identities.delete(key);
    };
    cleanups.add(cleanup);
    socket.on('close', cleanup);
    socket.on('error', () => socket.close());
    socket.on('message', (data, binary) => {
      if (binary) {
        if (connected && !closed) {
          try { session.pcm(data); }
          catch (error) { send({ type: 'error', message: `音频发送失败：${error.message}` }); }
        }
        return;
      }
      let message;
      try { message = JSON.parse(data.toString()); if (!message || typeof message !== 'object') throw new Error('请求格式不正确'); }
      catch { send({ type: 'error', message: '请求格式不正确' }); return; }
      if (message.type === 'ping' && connected && !closed) {
        send({ type: 'ack', id: message.id, stats: session.connectionStats() });
        return;
      }
      queue = queue.then(async () => {
        if (closed) return;
        try {
          if (message.type === 'join') {
            if (session) throw new Error('当前连接已经加入服务器');
            if (config.webPassword && message.password !== config.webPassword) throw new Error('访问密码不正确');
            const nickname = String(message.nickname || '').trim();
            if ([...nickname].length < 3 || [...nickname].length > 30) throw new Error('昵称需要 3–30 个字符');
            if (!/^[a-f0-9-]{36}$/i.test(message.identity || '')) throw new Error('浏览器身份无效，请重新打开页面');
            if (identities.has(message.identity)) throw new Error('这个浏览器身份已在通话中，请关闭另一个通话标签页');
            const target = { ...parseServerAddress(message.serverAddress), password: String(message.serverPassword || '') };
            key = message.identity;
            identities.add(key);
            session = sessionFactory(config, key, nickname, target);
            session.on('voice', frame => {
              if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128 * 1024) return;
              const packet = Buffer.allocUnsafe(frame.data.length + 3);
              packet.writeUInt16BE(frame.clientId, 0); packet[2] = frame.codec;
              packet.set(frame.data, 3); socket.send(packet);
            });
            session.on('chat', chat => send({ type: 'chat', ...chat }));
            session.on('notice', message => send({ type: 'notice', message }));
            session.on('change', scheduleRefresh);
            session.on('disconnect', reason => {
              send({ type: 'disconnected', message: reason }); socket.close();
            });
            await session.connect();
            if (closed) { await session.close(); return; }
            connected = true;
            send({ type: 'joined', nickname: session.nickname || nickname, serverAddress: target.address });
            await refresh();
          } else {
            if (!connected) throw new Error('请先连接 TeamSpeak');
            if (message.type === 'leave') {
              await cleanup();
              if (message.id) send({ type: 'ack', id: message.id });
              socket.close();
              return;
            } else if (message.type === 'chat') {
              const text = String(message.text || '').trim();
              if (!text || Buffer.byteLength(text, 'utf8') > 1024) throw new Error('消息需要 1–1024 字节');
              send({ type: 'chat', ...await session.chat(text) });
            } else if (message.type === 'move') {
              if (!/^\d+$/.test(String(message.channelId))) throw new Error('频道编号无效');
              await session.move(message.channelId, String(message.password || ''));
              await refresh();
            } else if (message.type === 'audio-state') {
              await session.audioState(Boolean(message.muted), Boolean(message.deafened));
            } else if (message.type === 'channel-info') {
              if (!/^\d+$/.test(String(message.channelId))) throw new Error('频道编号无效');
              send({ type: 'ack', id: message.id, channel: await session.channelInfo(String(message.channelId)) });
              return;
            } else if (message.type === 'refresh') {
              await refresh();
            } else throw new Error('不支持的操作');
          }
          if (message.id) send({ type: 'ack', id: message.id });
        } catch (error) {
          send({ type: 'error', id: message?.id, message: error.message });
          if (!connected && session) socket.close();
        }
      }).catch(error => { console.error(error); socket.close(); });
    });
  });
  // Heartbeats release TeamSpeak slots when a browser or network disappears.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.alive === false) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 30_000);
  wss.on('connection', socket => { socket.alive = true; socket.on('pong', () => { socket.alive = true; }); });
  return {
    server,
    async close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await Promise.all([...cleanups].map(cleanup => cleanup()));
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}
