import type { HostToPhone, PhoneToHost, ServerErrorCode, ServerToClient } from '@wb/shared';
import { PeerLink, type LinkMode, type SignalData } from './peerLink';
import { forceRelay, ServerSocket } from './serverSocket';

export interface PhoneNetworkEvents {
  onJoined(sessionToken: string): void;
  onHostMessage(msg: HostToPhone): void;
  onError(code: ServerErrorCode): void;
  onHostLeft(): void;
  onHostBack(): void;
  onMode(mode: LinkMode): void;
  onServerStatus(status: string): void;
}

/** Phone side networking: joins a room and keeps one PeerLink to the host. */
export class PhoneNetwork {
  readonly socket = new ServerSocket();
  private link: PeerLink | null = null;
  private code = '';
  private token: string | undefined;

  constructor(private readonly ev: PhoneNetworkEvents) {
    this.socket.onMessage((m) => this.handle(m));
    this.socket.onStatus((s) => ev.onServerStatus(s));
    this.socket.onOpen(() => {
      if (this.code) this.socket.send({ t: 'peer.join', code: this.code, sessionToken: this.token });
    });
  }

  join(code: string, token?: string): void {
    this.code = code;
    this.token = token;
    if (this.socket.status === 'open') this.socket.send({ t: 'peer.join', code, sessionToken: token });
    else this.socket.connect();
  }

  private newLink() {
    this.link?.close();
    const link = new PeerLink(
      'phone',
      (d: SignalData) => this.socket.send({ t: 'signal', to: 'host', data: d }),
      (data) => this.socket.send({ t: 'relay', to: 'host', data }),
      !forceRelay(),
    );
    link.onMessage = (raw) => {
      try {
        this.ev.onHostMessage(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    };
    link.onMode = (m) => this.ev.onMode(m);
    this.link = link;
  }

  private handle(m: ServerToClient) {
    switch (m.t) {
      case 'peer.joined':
        this.token = m.sessionToken;
        this.newLink();
        this.ev.onJoined(m.sessionToken);
        break;
      case 'signal':
        void this.link?.handleSignal(m.data as SignalData);
        break;
      case 'relay':
        this.link?.handleRelay(m.data);
        break;
      case 'host.left':
        this.ev.onHostLeft();
        break;
      case 'host.back':
        this.newLink();
        this.ev.onHostBack();
        break;
      case 'error':
        this.ev.onError(m.code);
        if (m.code === 'room_not_found' || m.code === 'kicked' || m.code === 'room_full') {
          this.code = '';
          this.socket.close();
        }
        break;
    }
  }

  send(msg: PhoneToHost, unreliable = false): void {
    this.link?.send(JSON.stringify(msg), unreliable);
  }

  get mode(): LinkMode {
    return this.link?.mode ?? 'connecting';
  }
}
