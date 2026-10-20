/**
 * Anonymous telemetry (PRIV-02): no cookies, no ids – just event name + a few numbers.
 * Sent to the own server, which logs locally and optionally forwards to App Insights.
 */
export function telemetry(name: string, props: Record<string, string | number | boolean> = {}): void {
  try {
    const body = JSON.stringify({ name, props });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/telemetry', { method: 'POST', body, keepalive: true });
  } catch {
    /* ignore */
  }
}

/** Periodic fps / quality sample for balancing performance (PERF-01). */
export function startPerfTelemetry(getFps: () => number, getQuality: () => number): void {
  setInterval(() => telemetry('perf', { fps: Math.round(getFps()), quality: getQuality(), w: innerWidth, h: innerHeight }), 120000);
}
