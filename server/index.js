import { readConfig } from './config.js';
import { createApp } from './app.js';

const config = readConfig();
const app = createApp(config);
app.server.listen(config.port, '0.0.0.0', () => {
  console.log(`TSWeb: http://localhost:${config.port}`);
  if (!config.tsHost) console.log('尚未配置 TS_HOST，设置后重启即可连接 TeamSpeak。');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
