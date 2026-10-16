import path from 'node:path';

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  const securityLevel = Number(env.TS_SECURITY_LEVEL || 8);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 必须是 1–65535 的整数');
  }
  if (!Number.isInteger(securityLevel) || securityLevel < 8 || securityLevel > 20) {
    throw new Error('TS_SECURITY_LEVEL 必须是 8–20 的整数');
  }
  return {
    port, securityLevel,
    serverName: env.SERVER_NAME || 'TSWeb',
    webPassword: env.WEB_PASSWORD || '',
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    distDir: path.resolve('dist'),
  };
}
