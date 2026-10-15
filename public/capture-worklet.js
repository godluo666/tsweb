class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(960);
    this.offset = 0;
    this.port.onmessage = event => { if (event.data === 'reset') this.offset = 0; };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const value = Math.max(-1, Math.min(1, input[i]));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === 960) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(960);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('tsweb-capture', CaptureProcessor);
