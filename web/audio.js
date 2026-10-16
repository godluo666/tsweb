import { OpusDecoder } from 'opus-decoder';

export class VoiceAudio {
  constructor(onSpeaking, onError) {
    this.onSpeaking = onSpeaking;
    this.onError = onError;
    this.decoders = new Map();
    this.muted = true;
    this.deafened = false;
    this.volume = 1;
    this.userVolumes = new Map();
  }

  async prepare() {
    if (!window.isSecureContext) throw new Error('麦克风需要 HTTPS。请使用可信的 HTTPS 地址，或在本机使用 localhost。');
    this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.context.resume();
    if (this.context.sampleRate !== 48000) throw new Error('当前浏览器无法启用 48 kHz 音频，请使用新版 Chrome、Edge、Firefox 或 Safari。');
    await Promise.all([
      this.context.audioWorklet.addModule('/capture-worklet.js'),
      this.context.audioWorklet.addModule('/voice-player-worklet.js'),
    ]);
    this.player = new AudioWorkletNode(this.context, 'voice-player', { outputChannelCount: [2] });
    for (const [clientId, value] of this.userVolumes) this.setUserVolume(clientId, value);
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.player.connect(this.gain).connect(this.context.destination);
    this.player.port.onmessage = event => {
      if (event.data.type === 'activity') {
        const ids = event.data.speaking;
        if (!this.muted && this.selfId && performance.now() < this.micSpeakingUntil) ids.push(this.selfId);
        this.onSpeaking(ids);
      }
    };
  }

  async startMicrophone(send) {
    if (!this.stream) {
      const context = this.context;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.context !== context || context.state === 'closed') {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('通话已经结束');
      }
      this.stream = stream;
      this.source = context.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(context, 'tsweb-capture');
      this.capture.port.onmessage = event => {
        if (this.muted) return;
        const samples = new Int16Array(event.data);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        if (Math.sqrt(energy / samples.length) > 160) this.micSpeakingUntil = performance.now() + 180;
        send(event.data);
      };
      const silent = context.createGain();
      silent.gain.value = 0;
      this.source.connect(this.capture).connect(silent).connect(context.destination);
      for (const track of stream.getTracks()) track.onended = () => {
        this.muted = true;
        this.onError('麦克风已断开，请重新连接通话');
      };
    }
    await this.context.resume();
    this.setMuted(false);
  }

  setMuted(muted) {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !muted;
    this.capture?.port.postMessage('reset');
  }

  setOutput(volume, deafened) {
    this.volume = volume;
    this.deafened = deafened;
    if (this.gain) this.gain.gain.value = deafened ? 0 : volume;
  }

  setUserVolume(clientId, value) {
    const volume = Math.max(0, Math.min(2, value));
    this.userVolumes.set(clientId, volume);
    this.player?.port.postMessage({ type: 'gain', clientId, value: volume });
  }

  syncUsers(clients) {
    const ids = new Set(clients.map(client => client.id));
    for (const [clientId, entry] of this.decoders) if (!ids.has(clientId)) {
      this.decoders.delete(clientId);
      entry.ready.then(() => entry.decoder.free());
    }
    for (const clientId of this.userVolumes.keys()) if (!ids.has(clientId)) {
      this.userVolumes.delete(clientId);
      this.player?.port.postMessage({ type: 'gain', clientId, value: 1 });
    }
  }

  async receive(buffer) {
    if (!this.player || this.deafened) return;
    const packet = new Uint8Array(buffer);
    if (packet.length < 4 || (packet[2] !== 4 && packet[2] !== 5)) return;
    const clientId = (packet[0] << 8) | packet[1];
    let entry = this.decoders.get(clientId);
    if (!entry) {
      const decoder = new OpusDecoder({ sampleRate: 48000, channels: 2 });
      entry = { decoder, ready: decoder.ready };
      this.decoders.set(clientId, entry);
    }
    await entry.ready;
    if (this.decoders.get(clientId) !== entry) return;
    const result = entry.decoder.decodeFrame(packet.subarray(3));
    if (result.errors.length) { this.onError('收到的语音包无法解码'); return; }
    const left = result.channelData[0];
    const right = result.channelData[1] || left;
    this.player?.port.postMessage({ type: 'pcm', clientId, left, right });
  }

  reset() {
    this.player?.port.postMessage({ type: 'reset' });
    for (const entry of this.decoders.values()) entry.ready.then(() => entry.decoder.free());
    this.decoders.clear();
    this.onSpeaking([]);
  }

  async close() {
    this.reset();
    this.setMuted(true);
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.source?.disconnect();
    this.capture?.disconnect();
    this.player?.disconnect();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
