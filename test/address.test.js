import test from 'node:test';
import assert from 'node:assert/strict';
import { parseServerAddress } from '../server/address.js';

test('服务器地址支持 IP、域名及自定义语音端口', () => {
  for (const [input, host, port] of [
    ['203.0.113.10', '203.0.113.10', 9987],
    ['203.0.113.10:10000', '203.0.113.10', 10000],
    [' ts.example.com ', 'ts.example.com', 9987],
    ['TS.Example.com:20000', 'ts.example.com', 20000],
    ['localhost:59987', 'localhost', 59987],
    ['[2001:db8::1]:10000', '2001:db8::1', 10000],
    ['2001:db8::1', '2001:db8::1', 9987],
  ]) {
    const target = parseServerAddress(input);
    assert.equal(target.host, host);
    assert.equal(target.port, port);
  }
  assert.equal(parseServerAddress('ts.example.com').explicitPort, false);
  assert.equal(parseServerAddress('ts.example.com').address, 'ts.example.com');
  assert.equal(parseServerAddress('ts.example.com:9987').explicitPort, true);
  assert.equal(parseServerAddress('ts.example.com:9987').address, 'ts.example.com:9987');
});

test('地址为空、误填网页 URL 或端口不正确时给出明确提示', () => {
  for (const input of ['', 'https://ts.example.com', 'ts.example.com/path', 'name@example.com', '999.1.1.1', 'ts.example.com:0', 'ts.example.com:65536', 'ts.example.com:abc']) {
    assert.throws(() => parseServerAddress(input), /IP 或域名/);
  }
});
