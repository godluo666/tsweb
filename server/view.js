import { parseCommand } from '@honeybbq/teamspeak-client/command';

// The voice protocol pushes the channels and clients visible to an ordinary user.
export class ServerView {
  constructor(onChange) {
    this.channels = new Map();
    this.clients = new Map();
    this.onChange = onChange;
    this.welcome = new Promise(resolve => { this.finishWelcome = resolve; });
  }

  packet(packet) {
    if (![2, 3].includes(packet.typeFlagged & 15)) return;
    for (const line of Buffer.from(packet.data).toString('utf8').replaceAll('\0', '\n').split(/\r?\n/)) {
      const space = line.indexOf(' ');
      const name = space < 0 ? line : line.slice(0, space);
      const rows = space < 0 ? [''] : line.slice(space + 1).split('|');
      let previous = {};
      for (const row of rows) {
        const parsed = parseCommand(`${name} ${row}`);
        if (!parsed) continue;
        const params = { ...previous, ...parsed.params };
        previous = params;
        this.command(name, params);
      }
    }
  }

  command(name, params) {
    if (name === 'channellistfinished') { this.finishWelcome(); return; }
    if (['channellist', 'notifychannelcreated', 'notifychanneledited', 'notifychannelmoved', 'notifychannelpasswordchanged'].includes(name)) {
      const id = params.cid;
      if (!id) return;
      const channel = this.channels.get(id) || { id, parentId: '0', order: '0', name: '', codec: 4, hasPassword: false };
      if (params.cpid !== undefined || params.pid !== undefined) channel.parentId = params.cpid ?? params.pid;
      if (params.channel_name !== undefined) channel.name = params.channel_name;
      if (params.channel_order !== undefined || params.order !== undefined) channel.order = params.channel_order ?? params.order;
      if (params.channel_codec !== undefined) channel.codec = Number(params.channel_codec);
      if (params.channel_flag_password !== undefined) channel.hasPassword = params.channel_flag_password === '1';
      for (const [key, field] of [['topic', 'channel_topic'], ['description', 'channel_description']]) {
        if (params[field] !== undefined) channel[key] = params[field];
      }
      for (const [key, field] of [['quality', 'channel_codec_quality'], ['maxClients', 'channel_maxclients'], ['neededTalkPower', 'channel_needed_talk_power']]) {
        if (params[field] !== undefined) channel[key] = Number(params[field]);
      }
      for (const [key, field] of [['permanent', 'channel_flag_permanent'], ['semiPermanent', 'channel_flag_semi_permanent'], ['isDefault', 'channel_flag_default'], ['unlimitedClients', 'channel_flag_maxclients_unlimited']]) {
        if (params[field] !== undefined) channel[key] = params[field] === '1';
      }
      this.channels.set(id, channel);
    } else if (name === 'notifychanneldeleted') {
      this.channels.delete(params.cid);
    } else if (name === 'notifycliententerview' || name === 'notifyclientupdated') {
      const id = Number(params.clid);
      const client = this.clients.get(id) || { id, name: '', channelId: '0', type: 0, muted: false, deafened: false };
      if (params.client_nickname !== undefined) client.name = params.client_nickname;
      if (params.client_unique_identifier !== undefined) client.uid = params.client_unique_identifier;
      if (params.ctid !== undefined) client.channelId = params.ctid;
      if (params.client_type !== undefined) client.type = Number(params.client_type);
      if (params.client_input_muted !== undefined) client.muted = params.client_input_muted === '1';
      if (params.client_output_muted !== undefined) client.deafened = params.client_output_muted === '1';
      this.clients.set(id, client);
    } else if (name === 'notifyclientmoved') {
      const client = this.clients.get(Number(params.clid));
      if (client) client.channelId = params.ctid;
    } else if (name === 'notifyclientleftview') {
      this.clients.delete(Number(params.clid));
    } else return;
    this.onChange();
  }

  snapshot(selfId) {
    return {
      selfId, channelId: this.clients.get(selfId)?.channelId || '0',
      channels: [...this.channels.values()],
      clients: [...this.clients.values()].filter(client => client.type === 0),
    };
  }
}
