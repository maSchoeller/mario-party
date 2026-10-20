/**
 * Ping based clock offset estimation (NET-05). The phone sends its local time c, the
 * host answers with its time h; offset ≈ h - (c + rtt/2). We keep the samples with the
 * lowest round trip times, which are the most accurate.
 */
export class ClockSync {
  private samples: { offset: number; rtt: number }[] = [];

  addSample(clientSend: number, hostTime: number, clientReceive: number): void {
    const rtt = clientReceive - clientSend;
    if (rtt < 0 || rtt > 5000) return;
    this.samples.push({ offset: hostTime - (clientSend + rtt / 2), rtt });
    if (this.samples.length > 20) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length >= 3;
  }

  get rtt(): number {
    if (!this.samples.length) return 0;
    return Math.min(...this.samples.map((s) => s.rtt));
  }

  /** host time = client time + offset */
  get offset(): number {
    if (!this.samples.length) return 0;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    return offsets[Math.floor(offsets.length / 2)];
  }

  toHost(clientTime: number): number {
    return clientTime + this.offset;
  }
}
