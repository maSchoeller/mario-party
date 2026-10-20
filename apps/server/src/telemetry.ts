import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Minimal anonymous telemetry (PRIV-02): no cookies, no ids across sessions. Events are
 * appended to a local NDJSON file; if APPLICATIONINSIGHTS_CONNECTION_STRING is set they
 * are forwarded to the Application Insights ingestion endpoint.
 */
export const ALLOWED_EVENTS = new Set([
  'game_started',
  'game_finished',
  'minigame_result',
  'error',
  'perf',
  'load_time',
  'connection',
]);

export interface TelemetryEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
}

export class Telemetry {
  private ingestion: { endpoint: string; ikey: string } | null = null;
  constructor(
    private readonly dir: string,
    connectionString?: string,
  ) {
    if (connectionString) {
      const parts = Object.fromEntries(connectionString.split(';').map((kv) => kv.split('=') as [string, string]));
      if (parts.InstrumentationKey && parts.IngestionEndpoint) {
        this.ingestion = { endpoint: parts.IngestionEndpoint.replace(/\/$/, ''), ikey: parts.InstrumentationKey };
      }
    }
  }

  sanitize(raw: unknown): TelemetryEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    const { name, props } = raw as { name?: unknown; props?: unknown };
    if (typeof name !== 'string' || !ALLOWED_EVENTS.has(name)) return null;
    const clean: Record<string, string | number | boolean> = {};
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props as Record<string, unknown>).slice(0, 30)) {
        if (typeof v === 'number' || typeof v === 'boolean') clean[k.slice(0, 40)] = v;
        else if (typeof v === 'string') clean[k.slice(0, 40)] = v.slice(0, 200);
      }
    }
    return { name, props: clean };
  }

  async track(ev: TelemetryEvent): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...ev });
    try {
      await mkdir(this.dir, { recursive: true });
      await appendFile(join(this.dir, 'telemetry.ndjson'), line + '\n');
    } catch {
      /* ignore */
    }
    if (this.ingestion) {
      const body = {
        name: 'Microsoft.ApplicationInsights.Event',
        time: new Date().toISOString(),
        iKey: this.ingestion.ikey,
        data: { baseType: 'EventData', baseData: { ver: 2, name: ev.name, properties: ev.props ?? {} } },
      };
      fetch(`${this.ingestion.endpoint}/v2/track`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    }
  }
}
