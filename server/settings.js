import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function validateSettings({ siteName, webPassword, securityLevel }) {
  if (typeof siteName !== 'string' || !siteName.trim() || [...siteName.trim()].length > 80) {
    throw new TypeError('网页名称需要 1–80 个字符');
  }
  if (typeof webPassword !== 'string' || webPassword.length > 256) {
    throw new TypeError('网页访问密码最多 256 个字符');
  }
  if (!Number.isInteger(securityLevel) || securityLevel < 8 || securityLevel > 20) {
    throw new RangeError('TS 身份安全等级必须是 8–20 的整数');
  }
  return { serverName: siteName.trim(), webPassword, securityLevel };
}

async function persist(config, values) {
  const file = path.join(config.dataDir, 'settings.json');
  await writeFile(`${file}.tmp`, JSON.stringify(values, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

export async function loadSettings(config) {
  await mkdir(config.dataDir, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(path.join(config.dataDir, 'settings.json'), 'utf8'));
    const values = validateSettings({ siteName: saved.serverName, webPassword: saved.webPassword, securityLevel: saved.securityLevel });
    if (typeof saved.adminPassword !== 'string' || !saved.adminPassword) throw new Error('网站设置缺少管理密码');
    Object.assign(config, values, { adminPassword: saved.adminPassword });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const values = validateSettings({ siteName: config.serverName, webPassword: config.webPassword, securityLevel: config.securityLevel });
    config.adminPassword = randomBytes(24).toString('base64url');
    await persist(config, { ...values, adminPassword: config.adminPassword });
    Object.assign(config, values);
  }
}

export async function saveSettings(config, input) {
  const values = validateSettings(input);
  await persist(config, { ...values, adminPassword: config.adminPassword });
  Object.assign(config, values);
}
