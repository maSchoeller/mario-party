import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import { RoomRegistry, ROOM_TTL_MS, type Conn } from '../src/rooms';
import { MemorySaveStore } from '../src/saves';

type Msg = Record<string, any>;

class Client {
  ws: WebSocket;
  inbox: Msg[] = [];
  waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = this.waiters.find((x) => x.pred(m));
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      } else this.inbox.push(m);
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: Msg) {
    this.ws.send(JSON.stringify(m));
  }
  next(pred: (m: Msg) => boolean = () => true, timeout = 2000): Promise<Msg> {
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
    });
  }
  close() {
    this.ws.close();
  }
}

describe('server', () => {
  let app: ReturnType<typeof createApp>;
  let base: string;
  beforeEach(async () => {
    app = createApp({ saves: new MemorySaveStore(), roomRate: { capacity: 3, perSec: 0.001 } });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
    const port = (app.server.address() as AddressInfo).port;
    base = `127.0.0.1:${port}`;
  });
  afterEach(() => app.close());

  async function client() {
    const c = new Client(`ws://${base}/ws`);
    await c.open();
    return c;
  }

  it('creates a room with a 4-char unambiguous code and lets peers join and signal', async () => {
    const host = await client();
    host.send({ t: 'host.create' });
    const created = await host.next((m) => m.t === 'host.created');
    expect(created.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}$/);
    const phone = await client();
    phone.send({ t: 'peer.join', code: created.code.toLowerCase() });
    const joined = await phone.next((m) => m.t === 'peer.joined');
    const connected = await host.next((m) => m.t === 'peer.connected');
    expect(connected.peerId).toBe(joined.peerId);
    expect(connected.sessionToken).toBe(joined.sessionToken);
    phone.send({ t: 'signal', to: 'host', data: { sdp: 'x' } });
    expect(await host.next((m) => m.t === 'signal')).toMatchObject({ from: joined.peerId, data: { sdp: 'x' } });
    host.send({ t: 'relay', to: joined.peerId, data: { hello: 1 } });
    expect(await phone.next((m) => m.t === 'relay')).toMatchObject({ from: 'host', data: { hello: 1 } });
    host.close();
    phone.close();
  });

  it('rejects unknown rooms and keeps session tokens for reconnects', async () => {
    const host = await client();
    host.send({ t: 'host.create' });
    const { code } = await host.next((m) => m.t === 'host.created');
    const bad = await client();
    bad.send({ t: 'peer.join', code: 'ZZZZ' });
    expect((await bad.next()).code).toBe('room_not_found');
    const p1 = await client();
    p1.send({ t: 'peer.join', code });
    const j1 = await p1.next((m) => m.t === 'peer.joined');
    p1.close();
    await host.next((m) => m.t === 'peer.left');
    const p2 = await client();
    p2.send({ t: 'peer.join', code, sessionToken: j1.sessionToken });
    const j2 = await p2.next((m) => m.t === 'peer.joined');
    expect(j2.sessionToken).toBe(j1.sessionToken);
    const forged = await client();
    forged.send({ t: 'peer.join', code, sessionToken: 'forged' });
    expect((await forged.next((m) => m.t === 'peer.joined')).sessionToken).not.toBe('forged');
    [host, bad, p2, forged].forEach((c) => c.close());
  });

  it('lets a reloaded host reclaim its room (SAVE-03)', async () => {
    const host = await client();
    host.send({ t: 'host.create' });
    const created = await host.next((m) => m.t === 'host.created');
    const phone = await client();
    phone.send({ t: 'peer.join', code: created.code });
    await phone.next((m) => m.t === 'peer.joined');
    host.close();
    await phone.next((m) => m.t === 'host.left');
    const host2 = await client();
    host2.send({ t: 'host.create', resume: { code: created.code, hostToken: created.hostToken } });
    const again = await host2.next((m) => m.t === 'host.created');
    expect(again).toMatchObject({ code: created.code, resumed: true });
    await phone.next((m) => m.t === 'host.back');
    expect(await host2.next((m) => m.t === 'peer.connected')).toBeTruthy();
    const thief = await client();
    thief.send({ t: 'host.create', resume: { code: created.code, hostToken: 'nope' } });
    expect((await thief.next((m) => m.t === 'host.created')).code).not.toBe(created.code);
    [host2, phone, thief].forEach((c) => c.close());
  });

  it('limits room creation per IP (SEC-01)', async () => {
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await client();
      c.send({ t: 'host.create' });
      const m = await c.next();
      results.push(m.t === 'error' ? m.code : m.t);
      c.close();
    }
    expect(results.filter((r) => r === 'too_many_rooms').length).toBe(2);
  });

  it('peers cannot message other peers directly', async () => {
    const host = await client();
    host.send({ t: 'host.create' });
    const { code } = await host.next((m) => m.t === 'host.created');
    const a = await client();
    const b = await client();
    a.send({ t: 'peer.join', code });
    b.send({ t: 'peer.join', code });
    await a.next((m) => m.t === 'peer.joined');
    const jb = await b.next((m) => m.t === 'peer.joined');
    a.send({ t: 'relay', to: jb.peerId, data: 'spam' });
    await expect(b.next((m) => m.t === 'relay', 300)).rejects.toThrow();
    [host, a, b].forEach((c) => c.close());
  });

  it('stores and loads save games with owner check (SAVE-01/02)', async () => {
    const alloc = (await (await fetch(`http://${base}/api/saves`, { method: "POST" })).json()) as { code: string; owner: string };
    expect(alloc.code).toHaveLength(6);
    const put = await fetch(`http://${base}/api/saves/${alloc.code}`, {
      method: 'PUT',
      headers: { 'x-save-owner': alloc.owner },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`http://${base}/api/saves/${alloc.code}`);
    expect(await get.json()).toEqual({ hello: 'world' });
    const steal = await fetch(`http://${base}/api/saves/${alloc.code}`, {
      method: 'PUT',
      headers: { 'x-save-owner': 'x'.repeat(32) },
      body: '{}',
    });
    expect(steal.status).toBe(403);
    expect((await fetch(`http://${base}/api/saves/ABCDEF`)).status).toBe(404);
  });
});

describe('server restart', () => {
  it('a host can recreate its room with the old code and phones keep their tokens', () => {
    const reg = new RoomRegistry();
    const host: Conn = { id: 'h', send: () => {}, close: () => {} };
    const token = 'a'.repeat(32);
    const room = reg.createRoom(host, { code: 'ABCD', hostToken: 'b'.repeat(32) });
    expect(room.code).toBe('ABCD');
    const res = reg.join({ id: 'p', send: () => {}, close: () => {} }, 'ABCD', token);
    expect('peer' in res && res.peer.token).toBe(token);
    // a normal (not restored) room does not accept unknown tokens
    const other = reg.createRoom({ id: 'h2', send: () => {}, close: () => {} });
    const res2 = reg.join({ id: 'p2', send: () => {}, close: () => {} }, other.code, token);
    expect('peer' in res2 && res2.peer.token).not.toBe(token);
  });
});

describe('room registry expiry (LOBBY-06)', () => {
  it('removes rooms after 2 h of inactivity', () => {
    let t = 0;
    const reg = new RoomRegistry(() => t);
    const conn: Conn = { id: 'h', send: () => {}, close: () => {} };
    const room = reg.createRoom(conn);
    t = ROOM_TTL_MS - 1000;
    expect(reg.sweep()).toEqual([]);
    t = ROOM_TTL_MS + 1;
    expect(reg.sweep()).toEqual([room.code]);
  });
});
