const WINDOW_MS = 60_000;
const TIMEOUT_MS = 5_000;

export class ConnectionStats {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.probes = [];
  }

  sent(id) {
    this.probes.push({ id, sentAt: this.clock(), receivedAt: null });
    this.prune();
  }

  received(id) {
    const probe = this.probes.findLast(item => item.id === id && item.receivedAt === null);
    if (probe) probe.receivedAt = this.clock();
  }

  prune() {
    const cutoff = this.clock() - WINDOW_MS;
    this.probes = this.probes.filter(probe => probe.sentAt >= cutoff);
  }

  snapshot() {
    this.prune();
    const now = this.clock();
    const finished = this.probes.filter(probe => probe.receivedAt !== null || now - probe.sentAt >= TIMEOUT_MS);
    const successful = finished.filter(probe => probe.receivedAt !== null && probe.receivedAt - probe.sentAt <= TIMEOUT_MS);
    const latest = successful.at(-1);
    return {
      tsRttMs: latest && now - latest.receivedAt < 15_000 ? latest.receivedAt - latest.sentAt : null,
      packetLossPercent: finished.length ? (finished.length - successful.length) / finished.length * 100 : null,
      probes: finished.length,
      windowSeconds: WINDOW_MS / 1000,
    };
  }
}
