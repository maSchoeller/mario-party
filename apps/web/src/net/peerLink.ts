/**
 * One host<->phone link (NET-01..03). Messages go over WebRTC DataChannels when they are
 * open – a reliable/ordered channel for game events and an unreliable/unordered one for
 * real-time input (~30 Hz) – and otherwise over the server WebSocket relay. Both sides
 * accept messages from either path, so no negotiation about the mode is necessary; the
 * relay simply carries the traffic until (or if never) P2P works.
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const P2P_TIMEOUT_MS = 5000;

export type LinkMode = 'connecting' | 'p2p' | 'relay';

export interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  cand?: RTCIceCandidateInit | null;
  reset?: boolean;
}

export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private rel: RTCDataChannel | null = null;
  private unrel: RTCDataChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  mode: LinkMode = 'connecting';
  onMessage: (data: string) => void = () => {};
  onMode: (m: LinkMode) => void = () => {};

  constructor(
    private readonly role: 'host' | 'phone',
    private readonly sendSignal: (d: SignalData) => void,
    private readonly sendRelay: (data: string) => void,
    private readonly p2pEnabled: boolean,
  ) {
    if (!p2pEnabled || typeof RTCPeerConnection === 'undefined') {
      this.setMode('relay');
      return;
    }
    this.timer = setTimeout(() => {
      if (this.mode !== 'p2p') this.setMode('relay');
    }, P2P_TIMEOUT_MS);
    if (role === 'host') void this.startOffer();
  }

  private setMode(m: LinkMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.onMode(m);
  }

  private createPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => this.sendSignal({ cand: e.candidate ? e.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        if (this.mode === 'p2p') this.setMode('relay');
      }
    };
    pc.ondatachannel = (e) => this.attach(e.channel);
    this.pc = pc;
    return pc;
  }

  private attach(ch: RTCDataChannel) {
    if (ch.label === 'rel') this.rel = ch;
    else this.unrel = ch;
    ch.onopen = () => this.checkOpen();
    ch.onclose = () => {
      if (this.mode === 'p2p') this.setMode('relay');
    };
    ch.onmessage = (e) => this.onMessage(typeof e.data === 'string' ? e.data : '');
    if (ch.readyState === 'open') this.checkOpen();
  }

  private checkOpen() {
    if (this.rel?.readyState === 'open' && this.unrel?.readyState === 'open') {
      if (this.timer) clearTimeout(this.timer);
      this.setMode('p2p');
    }
  }

  private async startOffer() {
    const pc = this.createPc();
    this.attach(pc.createDataChannel('rel', { ordered: true }));
    this.attach(pc.createDataChannel('unrel', { ordered: false, maxRetransmits: 0 }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ sdp: pc.localDescription!.toJSON() });
  }

  async handleSignal(d: SignalData): Promise<void> {
    if (!this.p2pEnabled || typeof RTCPeerConnection === 'undefined') return;
    try {
      if (d.sdp) {
        if (d.sdp.type === 'offer') {
          // phone side: a (new) offer from the host, e.g. after host reload
          this.closePc();
          const pc = this.createPc();
          await pc.setRemoteDescription(d.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal({ sdp: pc.localDescription!.toJSON() });
        } else if (this.pc) {
          await this.pc.setRemoteDescription(d.sdp);
        }
        for (const c of this.pendingCandidates.splice(0)) await this.pc?.addIceCandidate(c);
      } else if (d.cand !== undefined) {
        if (!d.cand) return;
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(d.cand);
        else this.pendingCandidates.push(d.cand);
      }
    } catch (err) {
      console.warn('signal error', err);
    }
  }

  /** Incoming relay message from the server. */
  handleRelay(data: unknown): void {
    if (typeof data === 'string') this.onMessage(data);
  }

  send(data: string, unreliable = false): void {
    const ch = unreliable ? this.unrel : this.rel;
    if (ch?.readyState === 'open') {
      try {
        ch.send(data);
        return;
      } catch {
        /* fall through to relay */
      }
    }
    this.sendRelay(data);
  }

  private closePc() {
    this.rel?.close();
    this.unrel?.close();
    this.pc?.close();
    this.rel = this.unrel = this.pc = null;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.closePc();
  }
}
