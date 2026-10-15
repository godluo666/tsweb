import path from 'node:path';

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  const tsPort = Number(env.TS_PORT || 9987);
  const securityLevel = Number(env.TS_SECURITY_LEVEL || 8);
  if (![port, tsPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error('PORT 和 TS_PORT 必须是 1–65535 的整数');
  }
  if (!Number.isInteger(securityLevel) || securityLevel < 8 || securityLevel > 20) {
    throw new Error('TS_SECURITY_LEVEL 必须是 8–20 的整数');
  }
  return {
    port, tsPort, securityLevel,
    tsHost: env.TS_HOST || '',
    serverName: env.SERVER_NAME || 'TeamSpeak',
    serverPassword: env.TS_PASSWORD || '',
    webPassword: env.WEB_PASSWORD || '',
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    distDir: path.resolve('dist'),
  };
}
