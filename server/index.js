import { readConfig } from './config.js';
import { createApp } from './app.js';
import { loadSettings } from './settings.js';

const config = readConfig();
await loadSettings(config);
const app = createApp(config);
app.server.listen(config.port, '0.0.0.0', () => {
  console.log(`TSWeb: http://localhost:${config.port}`);
  console.log(`管理密码：${config.adminPassword}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
