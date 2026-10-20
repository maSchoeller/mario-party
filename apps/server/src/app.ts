import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { BALANCE, isValidCode, normalizeCode, randomCode, type ClientToServer } from '@wb/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { KeyedLimiter, TokenBucket } from './ratelimit';
import { RoomRegistry, type Conn } from './rooms';
import { MAX_SAVE_BYTES, type SaveStore } from './saves';
import type { Telemetry } from './telemetry';

export interface AppOptions {
  saves: SaveStore;
  telemetry?: Telemetry;
  /** built web client (apps/web/dist) – served if present */
  staticDir?: string;
  now?: () => number;
  /** per-connection message rate (SEC-01) */
  msgRate?: { capacity: number; perSec: number };
  /** room creations per IP (SEC-01) */
  roomRate?: { capacity: number; perSec: number };
}

const MAX_MSG_BYTES = 64 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const registry = new RoomRegistry(now);
  const roomLimiter = new KeyedLimiter(opts.roomRate?.capacity ?? 10, opts.roomRate?.perSec ?? 10 / 600, now);
  const saveLimiter = new KeyedLimiter(60, 1, now);
  const msgRate = opts.msgRate ?? { capacity: 200, perSec: 100 };

  const server: Server = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > limit) return null;
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path === '/api/health') return json(res, 200, { ok: true, rooms: registry.rooms.size, saves: opts.saves.kind });
    if (path === '/api/info') return json(res, 200, { lan: lanAddresses(), publicUrl: process.env.PUBLIC_URL ?? null });
    if (path === '/api/telemetry' && req.method === 'POST') {
      const body = await readBody(req, 8 * 1024);
      if (body && opts.telemetry) {
        try {
          const ev = opts.telemetry.sanitize(JSON.parse(body));
          if (ev) await opts.telemetry.track(ev);
        } catch {
          /* ignore malformed */
        }
      }
      res.writeHead(204).end();
      return;
    }
    if (path === '/api/saves' && req.method === 'POST') {
      // allocate a new save code + owner secret
      if (!saveLimiter.take(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
      let code = '';
      for (let i = 0; i < 50; i++) {
        code = randomCode(6, () => randomBytes(4).readUInt32LE() / 0x100000000);
        if (!(await opts.saves.get(code))) break;
      }
      return json(res, 200, { code, owner: randomBytes(16).toString('hex') });
    }
    const saveMatch = path.match(/^\/api\/saves\/([A-Za-z0-9]{6})$/);
    if (saveMatch) {
      const code = normalizeCode(saveMatch[1]);
      if (!saveLimiter.take(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
      if (req.method === 'GET') {
        const rec = await opts.saves.get(code);
        if (!rec || now() - rec.updated > 7 * 24 * 3600 * 1000) return json(res, 404, { error: 'not_found' });
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(rec.data);
        return;
      }
      if (req.method === 'PUT') {
        const owner = req.headers['x-save-owner'];
        if (typeof owner !== 'string' || owner.length < 16) return json(res, 401, { error: 'bad_token' });
        const body = await readBody(req, MAX_SAVE_BYTES);
        if (!body) return json(res, 413, { error: 'too_large' });
        try {
          JSON.parse(body);
        } catch {
          return json(res, 400, { error: 'bad_json' });
        }
        const existing = await opts.saves.get(code);
        if (existing && existing.owner !== owner) return json(res, 403, { error: 'bad_token' });
        await opts.saves.put({ code, owner, updated: now(), data: body });
        return json(res, 200, { ok: true });
      }
    }
    if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    return serveStatic(path, res);
  }

  async function serveStatic(path: string, res: ServerResponse) {
    const dir = opts.staticDir;
    if (!dir || !existsSync(dir)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Würfel-Bande Server läuft. Web-Client: npm run dev (Vite) oder npm run build.');
      return;
    }
    let rel = path;
    if (rel === '/' || rel === '') rel = '/index.html';
    else if (rel === '/host' || rel === '/host/') rel = '/host.html';
    else if (rel === '/play' || rel === '/play/') rel = '/play.html';
    else if (rel === '/dev' || rel === '/dev/') rel = '/dev.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(normalize(dir))) return res.writeHead(403).end();
    try {
      const data = await readFile(file);
      const ext = extname(file);
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': rel.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  }

  // ------------------------------------------------------------------ WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
  });

  let connCounter = 0;
  function onConnection(ws: WebSocket, req: IncomingMessage) {
    const ip = clientIp(req);
    const conn: Conn = {
      id: `c${++connCounter}`,
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    const bucket = new TokenBucket(msgRate.capacity, msgRate.perSec, now);
    let alive = true;
    let strikes = 0;
    ws.on('pong', () => (alive = true));
    const hb = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20000);

    ws.on('message', (raw) => {
      if (!bucket.take()) {
        conn.send({ t: 'error', code: 'rate_limited' });
        if (++strikes > 50) ws.close(4008, 'rate limited');
        return;
      }
      let msg: ClientToServer;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return conn.send({ t: 'error', code: 'bad_message' });
      }
      handleMessage(conn, ip, msg);
    });
    ws.on('close', () => {
      clearInterval(hb);
      registry.leave(conn);
    });
    ws.on('error', () => {});
  }

  function handleMessage(conn: Conn, ip: string, msg: ClientToServer) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return conn.send({ t: 'error', code: 'bad_message' });
    switch (msg.t) {
      case 'host.create': {
        if (registry.lookup(conn)) return conn.send({ t: 'error', code: 'bad_message' });
        if (msg.resume && typeof msg.resume.code === 'string' && typeof msg.resume.hostToken === 'string') {
          const room = registry.resumeRoom(conn, normalizeCode(msg.resume.code), msg.resume.hostToken);
          if (room) {
            conn.send({ t: 'host.created', code: room.code, hostToken: room.hostToken, resumed: true });
            for (const p of room.peers.values()) conn.send({ t: 'peer.connected', peerId: p.peerId, sessionToken: p.token });
            return;
          }
        }
        if (!roomLimiter.take(ip)) return conn.send({ t: 'error', code: 'too_many_rooms' });
        const room = registry.createRoom(conn);
        return conn.send({ t: 'host.created', code: room.code, hostToken: room.hostToken, resumed: false });
      }
      case 'peer.join': {
        if (registry.lookup(conn)) return conn.send({ t: 'error', code: 'bad_message' });
        const code = normalizeCode(String(msg.code ?? ''));
        if (!isValidCode(code, BALANCE.roomCodeLength)) return conn.send({ t: 'error', code: 'room_not_found' });
        const token = typeof msg.sessionToken === 'string' ? msg.sessionToken : undefined;
        const res = registry.join(conn, code, token);
        if ('error' in res) return conn.send({ t: 'error', code: res.error });
        return conn.send({ t: 'peer.joined', peerId: res.peer.peerId, sessionToken: res.peer.token, hostOnline: !!res.room.host });
      }
      case 'signal':
      case 'relay': {
        if (typeof msg.to !== 'string') return conn.send({ t: 'error', code: 'bad_message' });
        registry.route(conn, msg.t, msg.to, msg.data);
        return;
      }
      case 'host.kick': {
        if (typeof msg.peerId === 'string') registry.kick(conn, msg.peerId);
        return;
      }
      case 'ping':
        registry.touch(conn);
        return conn.send({ t: 'pong', ts: msg.ts, server: now() });
      default:
        return conn.send({ t: 'error', code: 'bad_message' });
    }
  }

  const sweeper = setInterval(() => {
    registry.sweep();
    opts.saves.purgeExpired(now()).catch(() => {});
  }, 60000);

  return {
    server,
    registry,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
