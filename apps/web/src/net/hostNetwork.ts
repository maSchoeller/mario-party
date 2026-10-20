import type { HostToPhone, PhoneToHost, ServerToClient } from '@wb/shared';
import { PeerLink, type LinkMode, type SignalData } from './peerLink';
import { forceRelay, ServerSocket } from './serverSocket';

interface PeerEntry {
  peerId: string;
  token: string;
  link: PeerLink;
}

export interface HostNetworkEvents {
  onRoom(code: string, resumed: boolean): void;
  onPeerMessage(token: string, peerId: string, msg: PhoneToHost): void;
  onPeerLeft(token: string, peerId: string): void;
  onPeerMode(token: string, mode: LinkMode): void;
  onServerStatus(status: string): void;
}

const ROOM_KEY = 'wb.host.room';

/** Host side networking: one ServerSocket, one PeerLink per connected phone. */
export class HostNetwork {
  readonly socket = new ServerSocket();
  private peers = new Map<string, PeerEntry>();
  code: string | null = null;
  private hostToken: string | null = null;

  constructor(private readonly ev: HostNetworkEvents) {
    this.socket.onMessage((m) => this.handle(m));
    this.socket.onStatus((s) => ev.onServerStatus(s));
    this.socket.onOpen(() => {
      // (re)claim our room after reconnect or reload (SAVE-03)
      const saved = this.code && this.hostToken ? { code: this.code, hostToken: this.hostToken } : loadRoom();
      this.socket.send({ t: 'host.create', resume: saved ?? undefined });
    });
  }

  start(): void {
    this.socket.connect();
  }

  /** Forget the current room (new lobby). */
  newRoom(): void {
    for (const p of this.peers.values()) p.link.close();
    this.peers.clear();
    this.code = this.hostToken = null;
    try {
      sessionStorage.removeItem(ROOM_KEY);
    } catch {
      /* ignore */
    }
    this.socket.send({ t: 'host.create' });
  }

  private handle(m: ServerToClient) {
    switch (m.t) {
      case 'host.created':
        this.code = m.code;
        this.hostToken = m.hostToken;
        try {
          sessionStorage.setItem(ROOM_KEY, JSON.stringify({ code: m.code, hostToken: m.hostToken }));
        } catch {
          /* ignore */
        }
        if (!m.resumed) {
          for (const p of this.peers.values()) p.link.close();
          this.peers.clear();
        }
        this.ev.onRoom(m.code, m.resumed);
        break;
      case 'peer.connected': {
        this.peers.get(m.peerId)?.link.close();
        const peerId = m.peerId;
        const token = m.sessionToken;
        const link = new PeerLink(
          'host',
          (d: SignalData) => this.socket.send({ t: 'signal', to: peerId, data: d }),
          (data) => this.socket.send({ t: 'relay', to: peerId, data }),
          !forceRelay(),
        );
        link.onMessage = (raw) => {
          try {
            this.ev.onPeerMessage(token, peerId, JSON.parse(raw));
          } catch {
            /* ignore malformed */
          }
        };
        link.onMode = (mode) => this.ev.onPeerMode(token, mode);
        this.peers.set(peerId, { peerId, token, link });
        break;
      }
      case 'peer.left': {
        const p = this.peers.get(m.peerId);
        if (p) {
          p.link.close();
          this.peers.delete(m.peerId);
          this.ev.onPeerLeft(p.token, p.peerId);
        }
        break;
      }
      case 'signal':
        void this.peers.get(m.from)?.link.handleSignal(m.data as SignalData);
        break;
      case 'relay':
        this.peers.get(m.from)?.link.handleRelay(m.data);
        break;
      case 'error':
        console.warn('server error', m.code);
        break;
    }
  }

  send(peerId: string, msg: HostToPhone): void {
    this.peers.get(peerId)?.link.send(JSON.stringify(msg));
  }

  kick(peerId: string): void {
    this.socket.send({ t: 'host.kick', peerId });
  }

  peerMode(peerId: string): LinkMode | null {
    return this.peers.get(peerId)?.link.mode ?? null;
  }
}

function loadRoom(): { code: string; hostToken: string } | null {
  try {
    const raw = sessionStorage.getItem(ROOM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
