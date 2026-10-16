import fs from 'node:fs';
import assert from 'node:assert/strict';

const defaults = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
for (const deployment of [defaults, config]) {
  assert.deepEqual(Object.keys(deployment.services), ['tsweb']);
  assert.equal(deployment.services.tsweb.ports.length, 1);
  assert.equal(deployment.services.tsweb.ports[0].target, 8080);
  assert.equal(deployment.services.tsweb.environment.TS_HOST, undefined);
  assert.equal(deployment.services.tsweb.volumes[0].target, '/app/data');
}
assert.equal(defaults.services.tsweb.ports[0].host_ip, '127.0.0.1');
assert.equal(defaults.services.tsweb.ports[0].published, '8080');
assert.equal(config.services.tsweb.ports[0].host_ip, '0.0.0.0');
assert.equal(config.services.tsweb.ports[0].published, '18080');
// Compose escapes dollars when serializing a configuration for reuse.
assert.equal(config.services.tsweb.environment.WEB_PASSWORD.replaceAll('$$', '$'), "中文 pa'ss$word\\tail");
assert.equal(config.services.tsweb.environment.SERVER_NAME, '朋友的语音网页');
console.log('单容器 HTTP 部署可由 Docker Compose 解析，监听地址、端口和密码配置正确');
