import type { ClientToServer, ServerToClient } from '@wb/shared';

/**
 * WebSocket connection to the lobby/signaling server with automatic reconnect.
 * The server may be cold-starting (scale to zero, PERF-05) – callers get `onStatus`.
 */
export type SocketStatus = 'connecting' | 'open' | 'waking' | 'closed';

export class ServerSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerToClient) => void>();
  private statusListeners = new Set<(s: SocketStatus) => void>();
  private openListeners = new Set<() => void>();
  private attempts = 0;
  private stopped = false;
  private queue: ClientToServer[] = [];
  status: SocketStatus = 'connecting';

  constructor(private readonly url: string = defaultWsUrl()) {}

  connect(): void {
    this.stopped = false;
    this.setStatus(this.attempts > 0 ? 'waking' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
      for (const l of this.openListeners) l();
      const q = this.queue;
      this.queue = [];
      for (const m of q) this.send(m);
    };
    ws.onmessage = (ev) => {
      let msg: ServerToClient;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return this.setStatus('closed');
      this.attempts++;
      this.setStatus('waking');
      setTimeout(() => this.connect(), Math.min(5000, 400 * this.attempts));
    };
  }

  send(msg: ClientToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping') this.queue.push(msg);
  }

  onMessage(l: (m: ServerToClient) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: (s: SocketStatus) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  /** Called on every (re)connect. */
  onOpen(l: () => void): () => void {
    this.openListeners.add(l);
    return () => this.openListeners.delete(l);
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private setStatus(s: SocketStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}

export function defaultWsUrl(): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function forceRelay(): boolean {
  return new URLSearchParams(location.search).get('relay') === '1';
}
