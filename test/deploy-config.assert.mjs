import fs from 'node:fs';
import assert from 'node:assert/strict';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// Compose escapes dollars when serializing a configuration for reuse.
assert.equal(config.services.tsweb.environment.WEB_PASSWORD.replaceAll('$$', '$'), "中文 pa'ss$word\\tail");
assert.equal(config.services.tsweb.environment.SERVER_NAME, '朋友的语音网页');
assert.equal(config.services.tsweb.environment.TS_HOST, undefined);
assert.equal(config.services.caddy.ports.length, 2);
assert.equal(config.services.tsweb.ports, undefined);
console.log('部署配置可由 Docker Compose 解析，密码和中文配置完整保留');
