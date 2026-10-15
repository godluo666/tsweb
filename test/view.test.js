import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerView } from '../server/view.js';

test('普通客户端的欢迎序列与压缩批次构成频道树和成员列表', async () => {
  const view = new ServerView(() => {});
  view.packet({ typeFlagged: 2, data: Buffer.from('channellist cid=1 cpid=0 channel_order=0 channel_name=大厅 channel_codec=4|cid=2 cpid=1 channel_name=游戏\\s频道 channel_flag_password=1\nnotifycliententerview clid=10 ctid=1 client_nickname=甲用户 client_type=0|clid=11 client_nickname=乙用户\nchannellistfinished') });
  await view.welcome;
  const snapshot = view.snapshot(10);
  assert.equal(snapshot.channelId, '1');
  assert.equal(snapshot.channels[1].name, '游戏 频道');
  assert.equal(snapshot.channels[1].parentId, '1');
  assert.equal(snapshot.channels[1].hasPassword, true);
  assert.equal(snapshot.clients[1].channelId, '1');
});

test('移动、改名、静音与离开由服务器事件即时更新', () => {
  const view = new ServerView(() => {});
  const packet = text => view.packet({ typeFlagged: 2, data: Buffer.from(text) });
  packet('notifycliententerview clid=10 ctid=1 client_nickname=甲用户');
  packet('notifyclientmoved clid=10 ctid=2');
  packet('notifyclientupdated clid=10 client_nickname=新名字 client_input_muted=1');
  assert.deepEqual(view.snapshot(10).clients[0], { id: 10, channelId: '2', name: '新名字', type: 0, muted: true, deafened: false });
  packet('notifyclientleftview clid=10 reasonid=8');
  assert.equal(view.snapshot(10).clients.length, 0);
});
