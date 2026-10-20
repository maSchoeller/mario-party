import { randomBytes } from 'node:crypto';
import { BALANCE, MAX_PEERS_PER_ROOM, randomCode, type ServerErrorCode } from '@wb/shared';

/**
 * In-memory lobby registry (OPS-04: one replica). Holds rooms, host/peer connections
 * and session tokens. Transport agnostic – the WebSocket layer passes `Conn` objects.
 */
export interface Conn {
  id: string;
  send(msg: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface Peer {
  peerId: string;
  conn: Conn;
  token: string;
}

export interface Room {
  code: string;
  hostToken: string;
  host: Conn | null;
  peers: Map<string, Peer>;
  /** valid session tokens of this room (LOBBY-05 reconnect) */
  tokens: Set<string>;
  lastActivity: number;
  /** recreated after a server restart */
  restored?: boolean;
}

export const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // LOBBY-06
export const MAX_TOKENS_PER_ROOM = 32;

export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  private connRoom = new Map<string, { room: Room; role: 'host' | 'peer'; peerId?: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Creates a room. After a server restart (rooms live in memory) a host may ask for its old
   * code + token back, so phones can reconnect without scanning again.
   */
  createRoom(host: Conn, restore?: { code: string; hostToken: string }): Room {
    if (restore && !this.rooms.has(restore.code) && /^[0-9a-f]{32}$/.test(restore.hostToken)) {
      const room: Room = { code: restore.code, hostToken: restore.hostToken, host, peers: new Map(), tokens: new Set(), lastActivity: this.now(), restored: true };
      this.rooms.set(room.code, room);
      this.connRoom.set(host.id, { room, role: 'host' });
      return room;
    }
    let code = '';
    for (let i = 0; i < 1000; i++) {
      code = randomCode(BALANCE.roomCodeLength, () => randomBytes(4).readUInt32LE() / 0x100000000);
      if (!this.rooms.has(code)) break;
    }
    if (this.rooms.has(code)) throw new Error('no free room code');
    const room: Room = {
      code,
      hostToken: randomBytes(16).toString('hex'),
      host,
      peers: new Map(),
      tokens: new Set(),
      lastActivity: this.now(),
    };
    this.rooms.set(code, room);
    this.connRoom.set(host.id, { room, role: 'host' });
    return room;
  }

  /** Host reload (SAVE-03): reclaim the room with code + host token. */
  resumeRoom(host: Conn, code: string, hostToken: string): Room | null {
    const room = this.rooms.get(code);
    if (!room || room.hostToken !== hostToken) return null;
    if (room.host && room.host.id !== host.id) {
      this.connRoom.delete(room.host.id);
      room.host.close(4000, 'replaced');
    }
    room.host = host;
    room.lastActivity = this.now();
    this.connRoom.set(host.id, { room, role: 'host' });
    for (const p of room.peers.values()) p.conn.send({ t: 'host.back' });
    return room;
  }

  join(conn: Conn, code: string, sessionToken?: string): { room: Room; peer: Peer } | { error: ServerErrorCode } {
    const room = this.rooms.get(code);
    if (!room) return { error: 'room_not_found' };
    let token = sessionToken;
    // a restored room (server restart) does not know old tokens yet: accept well-formed ones
    // as long as there is room, so phones keep their seat at the host
    if (token && !room.tokens.has(token) && /^[0-9a-f]{32}$/.test(token) && room.tokens.size < MAX_TOKENS_PER_ROOM && room.restored) room.tokens.add(token);
    if (token && !room.tokens.has(token)) token = undefined;
    if (!token) {
      if (room.tokens.size >= MAX_TOKENS_PER_ROOM) return { error: 'room_full' };
      token = randomBytes(16).toString('hex');
      room.tokens.add(token);
    }
    // same token connected twice (e.g. reload): drop the old connection
    for (const p of room.peers.values()) {
      if (p.token === token) {
        this.leave(p.conn);
        p.conn.close(4003, 'replaced');
      }
    }
    if (room.peers.size >= MAX_PEERS_PER_ROOM) return { error: 'room_full' };
    const peer: Peer = { peerId: `p_${randomBytes(6).toString('hex')}`, conn, token };
    room.peers.set(peer.peerId, peer);
    room.lastActivity = this.now();
    this.connRoom.set(conn.id, { room, role: 'peer', peerId: peer.peerId });
    room.host?.send({ t: 'peer.connected', peerId: peer.peerId, sessionToken: token });
    return { room, peer };
  }

  lookup(conn: Conn) {
    return this.connRoom.get(conn.id);
  }

  /** Signaling / relay routing. Peers may only talk to the host, host to its peers. */
  route(conn: Conn, kind: 'signal' | 'relay', to: string, data: unknown): boolean {
    const entry = this.connRoom.get(conn.id);
    if (!entry) return false;
    const { room } = entry;
    room.lastActivity = this.now();
    if (entry.role === 'peer') {
      if (to !== 'host' || !room.host) return false;
      room.host.send({ t: kind, from: entry.peerId, data });
      return true;
    }
    const peer = room.peers.get(to);
    if (!peer) return false;
    peer.conn.send({ t: kind, from: 'host', data });
    return true;
  }

  kick(host: Conn, peerId: string): void {
    const entry = this.connRoom.get(host.id);
    if (!entry || entry.role !== 'host') return;
    const peer = entry.room.peers.get(peerId);
    if (!peer) return;
    entry.room.tokens.delete(peer.token);
    peer.conn.send({ t: 'error', code: 'kicked' });
    this.leave(peer.conn);
    peer.conn.close(4001, 'kicked');
  }

  leave(conn: Conn): void {
    const entry = this.connRoom.get(conn.id);
    if (!entry) return;
    this.connRoom.delete(conn.id);
    const { room } = entry;
    room.lastActivity = this.now();
    if (entry.role === 'host') {
      if (room.host?.id === conn.id) {
        room.host = null;
        for (const p of room.peers.values()) p.conn.send({ t: 'host.left' });
      }
    } else if (entry.peerId) {
      room.peers.delete(entry.peerId);
      room.host?.send({ t: 'peer.left', peerId: entry.peerId });
    }
  }

  /** Removes rooms that were inactive for 2 h (LOBBY-06). */
  sweep(): string[] {
    const removed: string[] = [];
    const t = this.now();
    for (const [code, room] of this.rooms) {
      if (t - room.lastActivity > ROOM_TTL_MS) {
        for (const p of room.peers.values()) {
          this.connRoom.delete(p.conn.id);
          p.conn.close(4002, 'expired');
        }
        if (room.host) {
          this.connRoom.delete(room.host.id);
          room.host.close(4002, 'expired');
        }
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  touch(conn: Conn): void {
    const e = this.connRoom.get(conn.id);
    if (e) e.room.lastActivity = this.now();
  }
}
