import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export function parseServerAddress(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  const invalid = () => new Error('请填写 IP 或域名，可带端口，例如 ts.example.com:9987');
  if (!value || /[\s/\\?#@]/.test(value)) throw invalid();
  let url;
  try { url = new URL(`ts://${isIP(value) === 6 ? `[${value}]` : value}`); }
  catch { throw invalid(); }
  let host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isIP(host)) {
    host = domainToASCII(host).replace(/\.$/, '');
    if (!host || host.length > 253 || /^[\d.]+$/.test(host)
      || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
  }
  const port = Number(url.port || 9987);
  if (port < 1 || port > 65535) throw invalid();
  const explicitPort = Boolean(url.port);
  const hostname = isIP(host) === 6 ? `[${host}]` : host;
  return { host, port, explicitPort, address: explicitPort ? `${hostname}:${port}` : hostname };
}
