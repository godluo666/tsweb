import { readConfig } from './config.js';
import { createApp } from './app.js';

const config = readConfig();
const app = createApp(config);
app.server.listen(config.port, '0.0.0.0', () => {
  console.log(`TSWeb: http://localhost:${config.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
