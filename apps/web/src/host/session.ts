import { Vector3 } from '@babylonjs/core';
import { BALANCE, CHARACTERS, PLAYER_COLOR_HEX, PLAYER_COLORS, type CharacterId, type PlayerColor } from '@wb/shared/config';
import { botAction, distance } from '@wb/shared/game/bots';
import { ActionError, createGame, GameEngine } from '@wb/shared/game/engine';
import { ITEMS } from '@wb/shared/game/items';
import type { Action, GameEvent, GameState, Pending, PlayerSetup } from '@wb/shared/game/types';
import { t } from '@wb/shared/i18n/index';
import { getField, getMap, MAP_IDS, MAPS } from '@wb/shared/maps/index';
import { ALL_MINIGAMES } from '@wb/shared/minigames/all';
import { minigameBotLevel } from '@wb/shared/minigames/types';
import type {
  ControllerView,
  HostToPhone,
  LobbySettings,
  MeInfo,
  PhoneDecision,
  PhoneToHost,
  PlayerInfo,
  ViewEnvelope,
} from '@wb/shared/net/protocol';
import { isNicknameAllowed, sanitizeNickname } from '@wb/shared/nickname';
import { Rng, randomSeed } from '@wb/shared/rng';
import type { LinkMode } from '../net/peerLink';
import { HostNetwork } from '../net/hostNetwork';
import type { HostAudio } from './audio';
import { MinigameRunner } from './minigameRunner';
import { BoardView } from './render/board';
import { CharacterRig } from './render/characters';
import type { Stage } from './render/stage';
import { h } from '../common/dom';
import { HostUI, type HudPlayer } from './ui';
import { telemetry } from './telemetry';

/**
 * Host session: the game authority (TECH-03). Owns lobby, player slots, the rules
 * engine, minigame runs, phone views, persistence (SAVE-01..04) and presentation.
 */
interface Slot {
  slot: number;
  token: string | null;
  peerId: string | null;
  name: string;
  character: CharacterId | null;
  color: PlayerColor;
  connected: boolean;
  /** CPU player (filled up at game start) */
  cpu: boolean;
  motion: boolean;
  mode: LinkMode;
  /** resumed save: a human seat that is not yet claimed */
  unclaimed?: boolean;
}

type Phase = 'start' | 'lobby' | 'game' | 'over';

interface Persisted {
  v: 1;
  phase: Phase;
  slots: Omit<Slot, 'peerId' | 'connected' | 'mode'>[];
  settings: LobbySettings;
  chief: number | null;
  game: GameState | null;
  save: { code: string; owner: string } | null;
  resuming: boolean;
}

const SESSION_KEY = 'wb.host.session';
const AFK_WARN_SEC = 25;
const AFK_LIMIT_SEC = 35;

export class HostSession {
  readonly net: HostNetwork;
  private slots: Slot[] = [];
  private peerToken = new Map<string, string>();
  private phase: Phase = 'start';
  private chief: number | null = null;
  private settings: LobbySettings = {
    mode: 'board',
    mapId: 'kokosnuss',
    rounds: 20,
    bots: true,
    botLevel: 'medium',
    teamMode: 'fields',
    noMotion: false,
    disabledMinigames: [],
  };
  private engine: GameEngine | null = null;
  private board: BoardView | null = null;
  private runner: MinigameRunner | null = null;
  private lobbyRigs: CharacterRig[] = [];
  private awaiting: { player: number; pending: Pending; resolve: (a: Action) => void } | null = null;
  private paused = false;
  private ff = false;
  private runId = 0;
  private save: { code: string; owner: string } | null = null;
  private resuming = false;
  private botRng = Rng.fromSeed(randomSeed());
  private overInfo: { ranking: number[] } | null = null;
  private presenting = false;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly ui: HostUI,
    private readonly audio: HostAudio,
  ) {
    this.net = new HostNetwork({
      onRoom: (code, resumed) => this.onRoom(code, resumed),
      onPeerMessage: (token, peerId, msg) => this.onPeerMessage(token, peerId, msg),
      onPeerLeft: (token, peerId) => this.onPeerLeft(token, peerId),
      onPeerMode: (token, mode) => {
        const s = this.slotByToken(token);
        if (s) {
          s.mode = mode;
          this.refreshHud();
        }
      },
      onServerStatus: (st) => this.ui.serverStatus(st === 'open' ? null : st === 'waking' ? t('host.wakingServer') : t('common.loading')),
    });
    audio.onSubtitle = (text) => ui.subtitle(text);
    // the recorded moderator says character names, never free-text nicknames (AUDIO-03)
    audio.characterOf = (name) => {
      const c = this.engine?.state.players.find((p) => p.name === name)?.character ?? this.slots.find((s) => s.name === name)?.character;
      return c ?? null;
    };
  }

  // ================================================================== start / restore

  /** Called on page load. Restores a running session after a reload (SAVE-03). */
  boot(): void {
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo) return this.startDemo(demo);
    const restored = this.restore();
    if (restored) {
      this.net.start();
      return;
    }
    this.showStart();
  }

  /**
   * Local test/demo mode without phones: /host?demo=kokosnuss|vulkan|bimmelbahn|marathon
   * (optional &rounds=20&ff=1&mg=<id> to force a minigame). Four CPU players play.
   */
  private startDemo(arg: string) {
    const q = new URLSearchParams(location.search);
    this.settings.mode = arg === 'marathon' ? 'marathon' : 'board';
    if (MAP_IDS.includes(arg)) this.settings.mapId = arg;
    const rounds = Number(q.get('rounds'));
    if (rounds === 20 || rounds === 25 || rounds === 30) this.settings.rounds = rounds;
    this.slots = CHARACTERS.map((character, i) => ({
      slot: i,
      token: null,
      peerId: null,
      name: t(`char.${character}`),
      character,
      color: PLAYER_COLORS[i],
      connected: false,
      cpu: true,
      motion: false,
      mode: 'relay' as LinkMode,
    }));
    this.phase = 'lobby';
    this.net.start();
    const forced = q.get('mg');
    this.skipRun = !!forced;
    this.startGame(true);
    if (forced && this.engine) {
      const def = ALL_MINIGAMES.find((m) => m.id === forced);
      if (def) {
        this.runId++;
        const players = def.format === 'duel' ? [0, 1] : [0, 1, 2, 3];
        const teams = def.format === '2v2' ? [0, 0, 1, 1] : def.format === '1v3' ? [0, 1, 1, 1] : def.format === 'duel' ? [0, 1] : [0, 1, 2, 3];
        void this.runMinigame({ kind: 'minigame', game: def.id, format: def.format, players, teams, purpose: 'round' });
      }
    }
    if (q.get('ff') === '1') this.setFastForward(true);
  }

  private showStart(error?: string) {
    this.phase = 'start';
    this.ui.setHud(null, [], 'none');
    this.ui.showStart(
      () => {
        this.audio.unlock();
        this.newLobby();
      },
      (code) => {
        this.audio.unlock();
        void this.resumeFromCode(code);
      },
      error,
    );
  }

  private newLobby() {
    this.phase = 'lobby';
    this.slots = [];
    this.chief = null;
    this.engine = null;
    this.save = null;
    this.resuming = false;
    this.disposeBoard();
    if (this.net.socket.status === 'open') this.net.newRoom();
    else this.net.start();
    this.showLobbyScene();
    this.persist();
  }

  private async resumeFromCode(raw: string) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let state: GameState | null = null;
    let owner: string | null = null;
    try {
      const res = await fetch(`/api/saves/${code}`);
      if (res.ok) state = (await res.json()) as GameState;
    } catch {
      /* offline – try local copy */
    }
    try {
      const local = JSON.parse(localStorage.getItem(`wb.save.${code}`) ?? 'null');
      if (local) {
        state = state ?? local.state;
        owner = local.owner;
      }
    } catch {
      /* ignore */
    }
    if (!state || state.version !== 1) return this.showStart(t('host.resumeNotFound'));
    this.engine = new GameEngine(state);
    this.save = { code, owner: owner ?? '' };
    this.resuming = true;
    this.settings = { ...this.settings, mode: state.config.mode, mapId: state.config.mapId, rounds: state.config.rounds };
    this.slots = state.players.map((p, i) => ({
      slot: i,
      token: null,
      peerId: null,
      name: p.name,
      character: p.character,
      color: p.color,
      connected: false,
      cpu: p.isBot,
      motion: false,
      mode: 'connecting' as LinkMode,
      unclaimed: !p.isBot,
    }));
    this.chief = null;
    this.phase = 'lobby';
    if (this.net.socket.status === 'open') this.net.newRoom();
    else this.net.start();
    this.showLobbyScene();
    this.persist();
  }

  private persist() {
    if (this.phase === 'start') return;
    const data: Persisted = {
      v: 1,
      phase: this.phase,
      slots: this.slots.map(({ peerId: _p, connected: _c, mode: _m, ...rest }) => rest),
      settings: this.settings,
      chief: this.chief,
      game: this.engine?.state ?? null,
      save: this.save,
      resuming: this.resuming,
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      /* quota */
    }
  }

  private restore(): boolean {
    let data: Persisted | null = null;
    try {
      data = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      data = null;
    }
    if (!data || data.v !== 1 || data.phase === 'start') return false;
    this.slots = data.slots.map((s) => ({ ...s, peerId: null, connected: false, mode: 'connecting' as LinkMode }));
    this.settings = data.settings;
    this.chief = data.chief;
    this.save = data.save;
    this.resuming = data.resuming;
    this.phase = data.phase;
    if (data.game) this.engine = new GameEngine(data.game);
    if (this.phase === 'game' && this.engine) {
      // continue the running game from the last stable state
      this.setupBoard();
      void this.runGame();
    } else if (this.phase === 'over' && this.engine) {
      this.setupBoard();
      this.overInfo = { ranking: this.engine.state.ranking ?? [0, 1, 2, 3] };
      void this.showGameOver();
    } else {
      this.phase = 'lobby';
      this.showLobbyScene();
    }
    this.ui.toast('🔄 ' + t('play.reconnecting'));
    return true;
  }

  // ================================================================== network

  private joinUrl(code: string): string {
    const base = (window as unknown as { WB_PUBLIC_URL?: string }).WB_PUBLIC_URL ?? this.publicBase ?? location.origin;
    return `${base}/play?code=${code}`;
  }

  private publicBase: string | null = null;

  private onRoom(code: string, resumed: boolean) {
    if (!this.publicBase) {
      // phones in the LAN cannot open "localhost" – use the server's LAN address for the QR code
      fetch('/api/info')
        .then((r) => r.json())
        .then((info: { lan: string[]; publicUrl: string | null }) => {
          if (info.publicUrl) this.publicBase = info.publicUrl.replace(/\/$/, '');
          else if (['localhost', '127.0.0.1'].includes(location.hostname) && info.lan[0]) this.publicBase = `${location.protocol}//${info.lan[0]}:${location.port}`;
          else this.publicBase = location.origin;
          if (this.phase === 'lobby') this.renderLobby();
        })
        .catch(() => {});
    }
    if (!resumed) {
      // the server lost our room (e.g. restart): all phones need to join again
      for (const s of this.slots) {
        s.connected = false;
        s.peerId = null;
      }
    }
    if (this.phase === 'lobby') this.renderLobby();
    void code;
    this.refreshHud();
  }

  private slotByToken(token: string): Slot | undefined {
    return this.slots.find((s) => s.token === token);
  }

  private send(slot: Slot, msg: HostToPhone) {
    if (slot.peerId) this.net.send(slot.peerId, msg);
  }

  private onPeerLeft(token: string, peerId: string) {
    this.peerToken.delete(peerId);
    const s = this.slotByToken(token);
    if (!s || s.peerId !== peerId) return;
    s.peerId = null;
    s.connected = false;
    if (this.phase === 'lobby' && !this.resuming && !this.engine) {
      // lobby: free the seat after a short grace period unless the phone comes back
      setTimeout(() => {
        if (!s.connected && this.phase === 'lobby' && !this.engine) {
          this.slots = this.slots.filter((x) => x !== s).map((x, i) => ({ ...x, slot: i, color: PLAYER_COLORS[i] }));
          this.fixChief();
          this.renderLobby();
          this.pushViews();
        }
      }, 15000);
    } else if (this.phase === 'game') {
      void this.audio.say('mod.disconnect', { player: s.name }, 800, this.speed());
      this.runner?.refreshBots();
      // BOT-02: bot takes over a pending decision
      if (this.awaiting?.player === s.slot) this.scheduleBot();
    }
    this.fixChief();
    this.refreshHud();
    this.renderLobby();
    this.pushViews();
    this.persist();
  }

  private onPeerMessage(token: string, peerId: string, msg: PhoneToHost) {
    if (msg.t === 'time') {
      this.net.send(peerId, { t: 'time', id: msg.id, c: msg.c, h: performance.now() });
      return;
    }
    if (msg.t === 'hello') return this.onHello(token, peerId, msg);
    if (msg.t === 'claim') return this.onClaim(token, peerId, msg.slot);
    const s = this.slotByToken(token);
    if (!s || s.peerId !== peerId) return;
    const isChief = this.chief === s.slot;
    switch (msg.t) {
      case 'pickChar':
        if (this.phase !== 'lobby' || this.resuming || !CHARACTERS.includes(msg.character)) return;
        if (this.slots.some((o) => o !== s && o.character === msg.character)) return; // LOBBY-04
        s.character = msg.character;
        this.audio.babble(msg.character);
        break;
      case 'settings':
        if (!isChief || this.phase !== 'lobby' || this.resuming) return;
        this.applySettings(msg.patch);
        break;
      case 'start':
        if (!isChief || this.phase !== 'lobby') return;
        this.startGame();
        return;
      case 'kick':
        if (!isChief) return;
        this.kick(msg.slot);
        break;
      case 'transferChief': {
        const target = this.slots[msg.slot];
        if (!isChief || !target || target.cpu || !target.connected) return;
        this.chief = target.slot;
        break;
      }
      case 'action':
        if (this.awaiting && this.awaiting.player === s.slot) {
          const a = this.awaiting;
          this.awaiting = null;
          if (this.botTimer) clearTimeout(this.botTimer);
          a.resolve(msg.action);
        }
        return;
      case 'mg':
        this.runner?.input(s.slot, msg.input);
        return;
      case 'ready':
        this.runner?.setReady(s.slot);
        return;
      case 'pause':
        if (!isChief) return;
        this.setPaused(msg.paused);
        return;
      case 'ff':
        if (!isChief) return;
        this.ff = msg.on;
        this.stage.timeScale = this.speed();
        return;
      case 'emoji':
        this.ui.emoji(s.slot, msg.emoji);
        this.audio.babble(s.character ?? 'rocco');
        return;
      case 'postgame':
        if (!isChief || this.phase !== 'over') return;
        if (msg.choice === 'rematch') this.startGame(true);
        else this.backToLobby();
        return;
    }
    this.renderLobby();
    this.pushViews();
    this.persist();
  }

  private onHello(token: string, peerId: string, msg: Extract<PhoneToHost, { t: 'hello' }>) {
    this.peerToken.set(peerId, token);
    let s = this.slotByToken(token);
    if (s) {
      // reconnect to the existing seat (LOBBY-05); the bot hands back control (BOT-02)
      const wasGone = !s.connected;
      s.peerId = peerId;
      s.mode = this.net.peerMode(peerId) ?? s.mode;
      s.connected = true;
      s.motion = msg.motion;
      if (wasGone && this.phase === 'game') void this.audio.say('mod.reconnect', { player: s.name }, 800, this.speed());
      this.runner?.refreshBots();
    } else {
      const name = sanitizeNickname(msg.name);
      if (!name || !isNicknameAllowed(name)) {
        this.net.send(peerId, { t: 'reject', reason: 'nickname' });
        return;
      }
      if (this.resuming && this.phase === 'lobby') {
        // resumed save: phone first picks its figure (SAVE-02) – temporary, unseated
        s = { slot: -1, token, peerId, name, character: null, color: 'red', connected: true, cpu: false, motion: msg.motion, mode: 'connecting' };
        this.pendingClaims.set(token, s);
        this.net.send(peerId, { t: 'view', v: this.claimEnvelope() });
        return;
      }
      if (this.phase !== 'lobby') {
        this.net.send(peerId, { t: 'reject', reason: 'running' });
        return;
      }
      const humans = this.slots.filter((x) => !x.cpu);
      if (humans.length >= 4) {
        this.net.send(peerId, { t: 'reject', reason: 'full' });
        return;
      }
      const slot = this.slots.length;
      const free = CHARACTERS.find((c) => !this.slots.some((x) => x.character === c)) ?? null;
      s = { slot, token, peerId, name, character: free, color: PLAYER_COLORS[slot], connected: true, cpu: false, motion: msg.motion, mode: this.net.peerMode(peerId) ?? 'connecting' };
      this.slots.push(s);
      if (this.chief === null) this.chief = slot; // LOBBY-03: first phone is chief
      this.audio.sfx('ding');
      if (free) this.audio.babble(free);
    }
    this.net.send(peerId, { t: 'welcome', slot: s.slot });
    this.fixChief();
    this.renderLobby();
    this.refreshHud();
    this.pushViews();
    this.persist();
  }

  private pendingClaims = new Map<string, Slot>();

  /** Resumed save: a phone takes over the seat of its figure (SAVE-02). */
  private onClaim(token: string, peerId: string, slot: number) {
    const target = this.slots[slot];
    const claimer = this.pendingClaims.get(token);
    if (!target || !target.unclaimed || !claimer || this.slotByToken(token)) return;
    this.pendingClaims.delete(token);
    target.token = token;
    target.peerId = peerId;
    target.connected = true;
    target.unclaimed = false;
    target.motion = claimer.motion;
    target.mode = this.net.peerMode(peerId) ?? 'connecting';
    if (this.engine) this.engine.state.players[slot].isBot = false;
    this.fixChief();
    this.runner?.refreshBots();
    this.net.send(peerId, { t: 'welcome', slot });
    this.renderLobby();
    this.refreshHud();
    this.pushViews();
    this.persist();
  }

  private claimEnvelope(): ViewEnvelope {
    return {
      me: null,
      chief: false,
      paused: false,
      view: {
        screen: 'claim',
        options: this.slots.filter((s) => !s.cpu).map((s) => ({ slot: s.slot, name: s.name, character: s.character!, taken: !s.unclaimed })),
      },
    };
  }

  private fixChief() {
    const cur = this.chief !== null ? this.slots[this.chief] : undefined;
    if (cur && cur.connected && !cur.cpu) return;
    // LOBBY-03: role moves to the next connected player
    const next = this.slots.find((s) => s.connected && !s.cpu && !s.unclaimed);
    this.chief = next ? next.slot : null;
  }

  private kick(slot: number) {
    const s = this.slots[slot];
    if (!s || s.slot === this.chief) return;
    if (s.peerId) {
      this.send(s, { t: 'reject', reason: 'kicked' });
      this.net.kick(s.peerId);
    }
    if (this.phase === 'lobby' && !this.resuming) {
      this.slots = this.slots.filter((x) => x !== s).map((x, i) => ({ ...x, slot: i, color: PLAYER_COLORS[i] }));
      if (this.chief !== null && this.chief > slot) this.chief--;
    } else {
      // during a game the seat is taken over by a bot for good
      s.token = null;
      s.peerId = null;
      s.connected = false;
      s.cpu = true;
      if (this.engine) this.engine.state.players[slot].isBot = true;
      this.runner?.refreshBots();
      if (this.awaiting?.player === slot) this.scheduleBot();
    }
  }

  private applySettings(p: Partial<LobbySettings>) {
    const s = this.settings;
    if (p.mode === 'board' || p.mode === 'marathon') s.mode = p.mode;
    if (p.mapId && MAP_IDS.includes(p.mapId)) {
      s.mapId = p.mapId;
      this.showLobbyScene();
    }
    if (p.rounds === 20 || p.rounds === 25 || p.rounds === 30) s.rounds = p.rounds;
    if (typeof p.bots === 'boolean') s.bots = p.bots;
    if (p.botLevel === 'easy' || p.botLevel === 'medium' || p.botLevel === 'hard') s.botLevel = p.botLevel;
    if (p.teamMode === 'fields' || p.teamMode === 'random') s.teamMode = p.teamMode;
    if (typeof p.noMotion === 'boolean') s.noMotion = p.noMotion;
    if (Array.isArray(p.disabledMinigames)) s.disabledMinigames = p.disabledMinigames.filter((id) => ALL_MINIGAMES.some((m) => m.id === id));
  }

  // ================================================================== lobby scene

  private renderLobby() {
    if (this.phase !== 'lobby') return;
    const code = this.net.code;
    if (!code) return;
    void this.ui.showLobby(code, this.joinUrl(code), this.hudPlayers(), {
      modeKey: `play.mode.${this.settings.mode}`,
      mapKey: this.settings.mode === 'board' ? MAPS[this.settings.mapId].nameKey : undefined,
      saveCode: this.resuming ? this.save?.code : null,
      resuming: this.resuming,
    });
    this.ui.setHud(null, [], 'none');
    this.updateLobbyRigs();
  }

  private showLobbyScene() {
    this.disposeBoard();
    for (const r of this.lobbyRigs) r.dispose();
    this.lobbyRigs = [];
    const map = getMap(this.settings.mapId);
    this.stage.setSky(map.palette.sky[0], map.palette.sky[1], map.palette.fog);
    this.audio.playMusic('lobby');
    this.renderLobby();
    if (!this.lobbyStop) {
      this.lobbyStop = this.stage.onUpdate((dt) => this.lobbyRigs.forEach((r) => r.update(dt)));
    }
    this.stage.setCamera({ alpha: -Math.PI / 2, beta: 1.32, radius: 13, target: new Vector3(3.2, 1.6, 0) }, 2, true);
    void this.audio.say('mod.welcome', undefined, 1000);
  }

  private lobbyStop: (() => void) | null = null;
  private lobbyKey = '';
  private lobbyGround: { dispose(): void } | null = null;

  private updateLobbyRigs() {
    const key = this.slots.map((s) => `${s.character}|${s.color}`).join(',');
    if (key === this.lobbyKey && this.lobbyRigs.length) return;
    this.lobbyKey = key;
    for (const r of this.lobbyRigs) r.dispose();
    this.lobbyRigs = [];
    if (!this.lobbyGround) {
      void import('./render/props').then(({ cyl, palm }) => {
        if (this.lobbyGround || this.phase !== 'lobby') return;
        const g = cyl(this.stage, 'lobbyIsland', { top: 15, bottom: 16, h: 1.2, tess: 10 }, '#b9d7a1');
        g.position.set(3, -0.6, 3);
        g.receiveShadows = true;
        const p1 = palm(this.stage, 'lobbyPalm1', undefined, 1.2);
        p1.position.set(-4.5, 0, 4);
        const p2 = palm(this.stage, 'lobbyPalm2', undefined, 1.2);
        p2.position.set(10, 0, 4);
        this.lobbyGround = {
          dispose: () => {
            g.dispose(false, false);
            p1.dispose(false, false);
            p2.dispose(false, false);
          },
        };
      });
    }
    // characters stand on the right half; the left half is covered by the QR card
    const list = this.resuming ? this.slots : this.slots.filter((s) => s.character);
    list.forEach((s, i) => {
      if (!s.character) return;
      const rig = new CharacterRig(this.stage, s.character, s.color, `lobby${i}`);
      rig.setPosition(new Vector3(1.2 + i * 2.2, 0, 0));
      rig.setAnim(i % 2 ? 'idle' : 'cheer');
      this.lobbyRigs.push(rig);
    });
  }

  private clearLobbyScene() {
    for (const r of this.lobbyRigs) r.dispose();
    this.lobbyRigs = [];
    this.lobbyKey = '';
    this.lobbyGround?.dispose();
    this.lobbyGround = null;
  }

  // ================================================================== game start

  private canStart(): boolean {
    if (this.resuming) return this.slots.some((s) => !s.cpu && !s.unclaimed && s.connected);
    const humans = this.slots.filter((s) => !s.cpu);
    return humans.length >= 2 && humans.every((s) => s.character) && (this.settings.bots || humans.length >= 3);
  }

  private startGame(rematch = false) {
    if (!rematch && !this.canStart()) return;
    if (this.resuming && this.engine) {
      // unclaimed human seats are played by bots until someone claims them
      for (const s of this.slots) if (s.unclaimed) s.connected = false;
      this.resuming = false;
      this.phase = 'game';
      this.clearLobbyScene();
      this.ui.setOverlay(null);
      this.setupBoard();
      void this.runGame();
      this.persist();
      return;
    }
    // fill up with bots (GAME-01)
    this.slots = this.slots.filter((s) => !s.cpu);
    const humans = this.slots.length;
    const target = this.settings.bots || humans < 3 ? 4 : humans;
    while (this.slots.length < target) {
      const i = this.slots.length;
      const character = this.randomFreeCharacter();
      this.slots.push({ slot: i, token: null, peerId: null, name: `${t(`char.${character}`)}`, character, color: PLAYER_COLORS[i], connected: false, cpu: true, motion: false, mode: 'relay' });
    }
    if (this.slots.length < 4) {
      // v1 engine always plays with 4 seats; the 4th seat without bots is skipped by a passive CPU
      // (open point, see docs/OPEN_POINTS.md) – we keep the bot to stay rule-consistent.
      while (this.slots.length < 4) {
        const i = this.slots.length;
        const character = this.randomFreeCharacter();
        this.slots.push({ slot: i, token: null, peerId: null, name: t(`char.${character}`), character, color: PLAYER_COLORS[i], connected: false, cpu: true, motion: false, mode: 'relay' });
      }
    }
    const setups: PlayerSetup[] = this.slots.map((s) => ({
      id: `p${s.slot}`,
      name: s.name,
      character: s.character!,
      color: s.color,
      isBot: s.cpu,
      botLevel: this.settings.botLevel,
    }));
    const state = createGame(
      {
        mode: this.settings.mode,
        mapId: this.settings.mapId,
        rounds: this.settings.rounds,
        seed: randomSeed(),
        teamMode: this.settings.teamMode,
        disabledMinigames: this.settings.disabledMinigames,
        noMotion: this.settings.noMotion,
      },
      setups,
    );
    this.engine = new GameEngine(state);
    this.save = null;
    this.phase = 'game';
    this.overInfo = null;
    this.clearLobbyScene();
    this.ui.setOverlay(null);
    this.setupBoard();
    telemetry('game_started', { mode: this.settings.mode, map: this.settings.mapId, rounds: this.settings.rounds, humans, bots: 4 - humans });
    if (!this.skipRun) void this.runGame();
    this.persist();
  }

  private skipRun = false;

  private backToLobby() {
    this.runId++;
    this.engine = null;
    this.phase = 'lobby';
    this.resuming = false;
    this.slots = this.slots.filter((s) => !s.cpu);
    this.disposeBoard();
    this.showLobbyScene();
    this.pushViews();
    this.persist();
  }

  private setupBoard() {
    this.disposeBoard();
    this.clearLobbyScene();
    const e = this.engine!;
    if (e.state.config.mode === 'board') {
      this.board = new BoardView(
        this.stage,
        e.map,
        e.state.players.map((p) => ({ character: p.character, color: p.color })),
      );
      this.board.setPositions(e.state.players.map((p) => p.field));
      this.board.setStar(e.state.starField);
      for (const b of e.state.coinBags) this.board.setBag(b.field, true);
      for (const tr of e.state.traps) this.board.setTrap(tr.field, tr.owner, e.state.players[tr.owner].color, true);
      const g = e.state.gimmick;
      if (g.tide) this.board.setTide(g.tide, false);
      if (g.lava) this.board.setLava(e.map.gimmickParams?.lavaGroups ?? [], g.lava.group);
      this.board.overview(true);
      this.audio.playMusic(e.map.musicKey as 'island', e.isFinale());
    } else {
      this.audio.playMusic('lobby');
    }
    this.refreshHud();
    this.renderGimmickWidget();
  }

  private disposeBoard() {
    this.runner?.dispose();
    this.runner = null;
    this.board?.dispose();
    this.board = null;
  }

  // ================================================================== game loop

  private speed(): number {
    return this.ff ? 3 : 1;
  }

  private async runGame() {
    const id = ++this.runId;
    const e = this.engine!;
    const alive = () => id === this.runId && this.engine === e;
    if (e.state.stage === 'intro') await this.present(e.start());
    while (alive()) {
      const p = e.pending;
      if (!p) break;
      if (p.kind === 'gameOver') {
        this.overInfo = { ranking: e.state.ranking ?? [0, 1, 2, 3] };
        this.phase = 'over';
        this.persist();
        void this.uploadSave();
        await this.showGameOver();
        break;
      }
      if (p.kind === 'minigame') {
        this.persist();
        const ranks = await this.runMinigame(p);
        if (!alive()) return;
        await this.present(e.submitMinigame(ranks));
        this.persist();
        continue;
      }
      const action = await this.decide(p);
      if (!alive()) return;
      let events: GameEvent[];
      try {
        events = e.act(p.player, action);
      } catch (err) {
        if (err instanceof ActionError) {
          console.warn('invalid action', action, err.message);
          continue;
        }
        throw err;
      }
      this.board?.clearArrows();
      await this.present(events);
      this.persist();
    }
  }

  private isBotSeat(i: number): boolean {
    const s = this.slots[i];
    return !s || s.cpu || !s.connected;
  }

  /** Waits for the decision of a player: phone input, or bot (BOT-02/04). */
  private decide(p: Exclude<Pending, { kind: 'minigame' } | { kind: 'gameOver' }>): Promise<Action> {
    return new Promise((resolve) => {
      this.awaiting = { player: p.player, pending: p, resolve };
      if (p.kind === 'branch' && this.board) {
        this.board.showArrows(this.engine!.state.players[p.player].field, p.options);
        this.board.focus(p.player, 18);
      } else if (p.kind === 'turnMenu' && this.board) this.board.focus(p.player);
      this.refreshHud();
      this.pushViews();
      if (this.isBotSeat(p.player)) this.scheduleBot();
      else this.startAfkTimer(p.player);
    });
  }

  private afkTimer: ReturnType<typeof setInterval> | null = null;
  private afkLeft: number | null = null;

  /** BOARD-04: an idle phone must not block the game – warn after 25 s, bot decides after 35 s. */
  private startAfkTimer(player: number) {
    if (this.afkTimer) clearInterval(this.afkTimer);
    let waited = 0;
    this.afkLeft = null;
    this.afkTimer = setInterval(() => {
      const a = this.awaiting;
      if (!a || a.player !== player) {
        if (this.afkTimer) clearInterval(this.afkTimer);
        this.afkTimer = null;
        this.afkLeft = null;
        return;
      }
      if (this.paused || this.presenting) return;
      waited++;
      if (waited >= AFK_WARN_SEC) {
        this.afkLeft = AFK_LIMIT_SEC - waited;
        this.ui.toast(t('host.afk', { player: this.pname(player), sec: this.afkLeft }), 1100);
        if (waited === AFK_WARN_SEC) {
          const s = this.slots[player];
          if (s) this.send(s, { t: 'vibrate', ms: 300 });
        }
        this.pushViews();
      }
      if (waited >= AFK_LIMIT_SEC && this.engine) {
        if (this.afkTimer) clearInterval(this.afkTimer);
        this.afkTimer = null;
        this.afkLeft = null;
        this.awaiting = null;
        a.resolve(botAction(this.engine, a.pending as never, this.botRng));
      }
    }, 1000);
  }

  private scheduleBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    const delay = (500 + this.botRng.next() * 700) / this.speed();
    this.botTimer = setTimeout(() => {
      const a = this.awaiting;
      if (!a || !this.engine) return;
      if (this.paused) return this.scheduleBot();
      if (!this.isBotSeat(a.player)) return;
      this.awaiting = null;
      a.resolve(botAction(this.engine, a.pending as never, this.botRng));
    }, delay);
  }

  private async runMinigame(p: Extract<Pending, { kind: 'minigame' }>): Promise<number[]> {
    const e = this.engine!;
    this.board?.setEnabled(false);
    this.ui.setHud(null, [], 'none');
    this.ui.setGimmick(null);
    const formLevels: Record<number, ReturnType<typeof minigameBotLevel>> = {};
    const runner = new MinigameRunner(this.stage, this.ui, this.audio, p, e.rng.int(1, 2 ** 30), {
      isBot: (gi) => this.isBotSeat(gi),
      botLevel: (gi) => (formLevels[gi] ??= minigameBotLevel(e.state.players[gi].botLevel, this.botRng)),
      playerInfo: (gi) => ({ name: e.state.players[gi].name, character: e.state.players[gi].character, color: e.state.players[gi].color }),
      pushViews: () => this.pushViews(),
      isPaused: () => this.paused,
      speed: () => this.speed(),
      telemetry: (n, pr) => telemetry(n, pr),
    });
    this.runner = runner;
    this.pushViews();
    const ranks = await runner.run();
    runner.dispose();
    this.runner = null;
    // results screen
    const rewardsPreview = this.rewardText(p, ranks);
    await this.ui.results(
      t(`mg.${p.game}.name`),
      p.players.map((gi, k) => ({ name: e.state.players[gi].name, color: e.state.players[gi].color, character: e.state.players[gi].character, rank: ranks[k], reward: rewardsPreview[k] })),
      3200 / this.speed(),
    );
    this.board?.setEnabled(true);
    this.board?.overview();
    if (e.state.config.mode === 'board') this.audio.playMusic(e.map.musicKey as 'island', e.isFinale());
    else this.audio.playMusic('lobby');
    this.refreshHud();
    this.renderGimmickWidget();
    return ranks;
  }

  private rewardText(p: Extract<Pending, { kind: 'minigame' }>, ranks: number[]): string[] {
    if (p.purpose === 'marathon') return ranks.map((r) => `+${(BALANCE.marathonPoints[r] ?? 0) * (p.double ? 2 : 1)} ${t('stats.points')}`);
    if (p.purpose === 'duel') return ranks.map((r) => (r === 0 && ranks[0] !== ranks[1] ? '⚔️ 🏆' : ''));
    if (p.format === 'ffa') return ranks.map((r) => `+${BALANCE.minigameFfaRewards[r] ?? 0} ●`);
    return ranks.map((r, k) => (r === 0 ? `+${p.format === '1v3' && p.teams[k] === 0 ? BALANCE.minigameSoloReward : BALANCE.minigameTeamReward} ●` : ''));
  }

  // ================================================================== presentation

  private pname(i: number | undefined): string {
    if (i === undefined || !this.engine) return '';
    return this.engine.state.players[i]?.name ?? '';
  }

  private async sleep(ms: number) {
    let left = ms / this.speed();
    while (left > 0) {
      await new Promise((r) => setTimeout(r, Math.min(100, left)));
      if (!this.paused) left -= 100;
    }
  }

  private async say(key: string, params?: Record<string, string | number>, min = 1200) {
    while (this.paused) await new Promise((r) => setTimeout(r, 150));
    await this.audio.say(key, params, min, this.speed());
  }

  /** Plays the engine events one after another with animation and moderator lines (BOARD-05). */
  private async present(events: GameEvent[]) {
    this.presenting = true;
    // phones leave the decision screen right away (no double taps while the TV animates)
    this.pushViews();
    const e = this.engine!;
    for (const ev of events) {
      while (this.paused) await new Promise((r) => setTimeout(r, 150));
      switch (ev.type) {
        case 'announce': {
          const params: Record<string, string | number> = { ...(ev.params ?? {}) };
          if (ev.player !== undefined) params.player = this.pname(ev.player);
          if (typeof params.leader === 'number') params.leader = this.pname(params.leader);
          if (ev.key.startsWith('mod.item.') || ev.key === 'mod.shopBought') this.audio.sfx('item');
          if (ev.key === 'mod.itemField') this.audio.sfx('itemJingle');
          await this.say(ev.key, params, 900);
          break;
        }
        case 'roundStart':
          this.refreshHud();
          if (ev.round > 1) await this.ui.banner(t('common.round', { round: ev.round, total: ev.total }), 1300 / this.speed());
          break;
        case 'turnStart':
          this.refreshHud();
          this.board?.focus(ev.player);
          this.audio.babble(e.state.players[ev.player].character);
          await this.say('mod.turn', { player: this.pname(ev.player) }, 700);
          break;
        case 'orderRoll':
          if (this.board) {
            this.board.focus(ev.player, 16);
            this.audio.sfx('dice');
            await this.board.rollDice(ev.player, [ev.roll], this.speed(), (k) => this.audio.diceClack(k));
            this.ui.popAtPlayer(ev.player, `🎲 ${ev.value}`, 'good');
            await this.sleep(500);
            void this.board.clearDice(this.speed());
          }
          break;
        case 'order':
          this.board?.overview();
          this.ui.toast(ev.order.map((i, k) => `${k + 1}. ${this.pname(i)}`).join('  ·  '), 3500);
          await this.sleep(1200);
          break;
        case 'dice':
          if (this.board) {
            this.board.focus(ev.player, 15);
            this.audio.sfx('dice');
            this.board.rigs[ev.player]?.setAnim('jump');
            await this.board.rollDice(ev.player, ev.rolls, this.speed(), (k) => this.audio.diceClack(k));
            this.board.rigs[ev.player]?.setAnim(ev.total > 0 ? 'cheer' : 'sad');
            void this.board.celebrateDice(this.speed());
            this.ui.diceResult(ev.rolls, ev.total, 1700 / this.speed());
            // the moderator only calls out the number (AUDIO-03, v0.3)
            await this.audio.sayNumber(ev.total, 900 / this.speed());
            this.board.rigs[ev.player]?.setAnim('idle');
            await this.board.clearDice(this.speed());
          }
          break;
        case 'move':
          if (this.board) {
            if (ev.kind === 'walk' || ev.kind === 'back') this.audio.sfx('step');
            else this.audio.sfx('whoosh');
            this.board.focus(ev.player, ev.kind === 'walk' ? 20 : 30);
            const done = this.board.move(ev.player, ev.from, ev.to, ev.kind);
            this.stage.timeScale = this.speed();
            await done;
          }
          break;
        case 'land':
          this.board?.focus(ev.player, 16);
          break;
        case 'coins':
          this.ui.popAtPlayer(ev.player, `${ev.delta > 0 ? '+' : ''}${ev.delta} ●`, ev.delta > 0 ? 'good' : 'bad');
          this.audio.sfx(ev.delta > 0 ? 'coin' : 'coinLoss');
          if (this.board && ev.delta >= 10) this.board.burst(this.board.tokenPos(ev.player).add(new Vector3(0, 1, 0)), 'coins', 6);
          this.board?.rigs[ev.player]?.setAnim(ev.delta > 0 ? 'cheer' : 'sad');
          this.refreshHud();
          await this.sleep(500);
          this.board?.rigs[ev.player]?.setAnim('idle');
          break;
        case 'stars':
          this.ui.popAtPlayer(ev.player, `${ev.delta > 0 ? '+' : ''}${ev.delta} ★`, ev.delta > 0 ? 'good' : 'bad');
          this.audio.sfx(ev.delta > 0 ? 'star' : 'coinLoss');
          this.board?.rigs[ev.player]?.setAnim(ev.delta > 0 ? 'cheer' : 'hit');
          this.refreshHud();
          await this.sleep(900);
          this.board?.rigs[ev.player]?.setAnim('idle');
          break;
        case 'item':
          this.ui.popAtPlayer(ev.player, `${ev.gained ? '+' : '−'} ${t(`item.${ev.item}.name`)}`);
          this.refreshHud();
          break;
        case 'itemUse':
          this.refreshHud();
          break;
        case 'starMoved':
          if (this.board) {
            this.board.focusField(ev.to, 30);
            await this.board.setStar(ev.to, true);
            await this.sleep(500);
          }
          break;
        case 'trap':
          this.board?.setTrap(ev.field, ev.owner, e.state.players[ev.owner].color, ev.placed);
          break;
        case 'wheel':
          await this.ui.wheel(ev.segments, ev.result, 2600 / this.speed());
          break;
        case 'tide':
          this.board?.setTide(ev.tide);
          this.board?.overview();
          this.renderGimmickWidget();
          await this.sleep(1200);
          break;
        case 'eruptionCounter':
          this.renderGimmickWidget();
          break;
        case 'eruption':
          this.board?.overview();
          this.stage.shakeCamera(1.6);
          this.audio.sfx('boom');
          if (this.board) {
            this.board.burst(new Vector3(0, 9, -2), 'rocks', 10);
            for (const hIdx of ev.hits) this.board.rigs[hIdx]?.setAnim('hit');
          }
          await this.sleep(1600);
          this.board?.rigs.forEach((r) => r.setAnim('idle'));
          break;
        case 'lava':
          this.board?.setLava(e.map.gimmickParams?.lavaGroups ?? [], ev.active ? ev.group : null);
          break;
        case 'coinBag':
          this.board?.setBag(ev.field, ev.placed);
          break;
        case 'timetable':
          this.board?.highlightRoute(ev.next[0] ?? null);
          this.renderGimmickWidget(ev.next);
          break;
        case 'train':
          if (this.board) {
            this.board.overview();
            this.audio.sfx('train');
            this.board.highlightRoute(ev.route);
            await this.board.runTrain(ev.route);
            for (const hIdx of ev.hits) this.board.rigs[hIdx]?.setAnim('hit');
            await this.sleep(600);
            this.board.rigs.forEach((r) => r.setAnim('idle'));
          }
          break;
        case 'standings':
          await this.showStandings(ev.ranking);
          break;
        case 'finale':
          this.audio.playMusic(e.map.musicKey as 'island', true);
          await this.ui.banner('🔥 FINALE 🔥', 1800 / this.speed(), 'finale');
          break;
        case 'minigameResult':
          this.refreshHud();
          break;
        case 'bonusStar':
          await this.revealBonus(ev);
          break;
        case 'gameOver':
          telemetry('game_finished', { mode: e.state.config.mode, map: e.state.config.mapId, rounds: e.state.config.rounds });
          break;
        case 'autosave':
          this.persist();
          void this.uploadSave();
          break;
      }
    }
    this.presenting = false;
    this.pushViews();
  }

  /** Interim ranking (CHAOS-01: the moderator announces the standings). */
  private async showStandings(ranking: number[]) {
    const e = this.engine!;
    this.ui.setOverlay(
      h(
        'div',
        { class: 'results card' },
        h('h2', {}, t('host.standings')),
        ranking.map((i, k) =>
          h(
            'div',
            { class: `rrow rank${k}`, style: `--pc:${PLAYER_COLOR_HEX[e.state.players[i].color]}` },
            h('span', { class: 'place' }, `${k + 1}.`),
            h('strong', {}, e.state.players[i].name),
            h('span', { class: 'reward' }, `★ ${e.state.players[i].stars} · ● ${e.state.players[i].coins}`),
          ),
        ),
      ),
    );
    await this.sleep(3200);
    this.ui.setOverlay(null);
  }

  private async revealBonus(ev: Extract<GameEvent, { type: 'bonusStar' }>) {
    // CHAOS-03: categories are revealed one at a time
    const names = ev.players.map((i) => this.pname(i));
    const card = h(
      'div',
      { class: 'bonus card' },
      h('div', { class: 'pill' }, t('host.bonusStars')),
      h('h1', {}, '★ ', t(`bonus.${ev.category}.name`)),
      h('p', {}, t(`bonus.${ev.category}.desc`)),
      h('h2', { class: 'who' }, names.length ? names.join(' & ') : t('bonus.nobody')),
    );
    this.ui.setOverlay(card);
    this.audio.sfx('fanfare');
    await this.say('mod.bonusStar', { category: `bonus.${ev.category}.name`, players: names.join(` ${t('voice.and')} `) || 'bonus.nobody' }, 2200);
    for (const i of ev.players) this.board?.rigs[i]?.setAnim('cheer');
    await this.sleep(1200);
    this.ui.setOverlay(null);
    this.board?.rigs.forEach((r) => r.setAnim('idle'));
  }

  private async showGameOver() {
    const e = this.engine!;
    const ranking = this.overInfo?.ranking ?? e.state.ranking ?? [0, 1, 2, 3];
    this.audio.playMusic('victory');
    this.audio.sfx('fanfare');
    this.board?.setEnabled(true);
    if (this.board) {
      this.board.focus(ranking[0], 12);
      this.board.rigs.forEach((r, i) => r.setAnim(i === ranking[0] ? 'cheer' : 'sad'));
    }
    const stats: (keyof typeof e.state.players[0]['stats'])[] = ['minigameWins', 'maxCoins', 'fieldsWalked', 'redFields', 'coinsSpent', 'duelWins', 'itemsUsed', 'starsBought'];
    const board = e.state.config.mode === 'board';
    const table = h(
      'table',
      { class: 'stats' },
      h('tr', {}, h('th', {}, ''), ranking.map((i) => h('th', { style: `color:var(--c${i})` }, this.pname(i)))),
      board ? h('tr', {}, h('td', {}, t('common.stars')), ranking.map((i) => h('td', {}, String(e.state.players[i].stars)))) : null,
      board ? h('tr', {}, h('td', {}, t('common.coins')), ranking.map((i) => h('td', {}, String(e.state.players[i].coins)))) : null,
      !board ? h('tr', {}, h('td', {}, t('stats.points')), ranking.map((i) => h('td', {}, String(e.state.players[i].points)))) : null,
      stats.map((k) => h('tr', {}, h('td', {}, t(`stats.${k}`)), ranking.map((i) => h('td', {}, String(e.state.players[i].stats[k]))))),
    );
    this.ui.setOverlay(
      h(
        'div',
        { class: 'gameover card' },
        h('h1', {}, '🏆 ', t('host.winner', { player: this.pname(ranking[0]) })),
        h('h2', {}, t('host.stats')),
        table,
        h('p', { class: 'hint' }, t('host.rematch')),
      ),
    );
    this.refreshHud();
    this.pushViews();
  }

  // ================================================================== saves (SAVE-01/02)

  private async uploadSave() {
    const e = this.engine;
    if (!e) return;
    try {
      if (!this.save) {
        const res = await fetch('/api/saves', { method: 'POST' });
        if (!res.ok) throw new Error('alloc failed');
        this.save = (await res.json()) as { code: string; owner: string };
        this.persist();
      }
      const body = JSON.stringify(e.state);
      localStorage.setItem(`wb.save.${this.save.code}`, JSON.stringify({ owner: this.save.owner, state: e.state, ts: Date.now() }));
      await fetch(`/api/saves/${this.save.code}`, { method: 'PUT', headers: { 'x-save-owner': this.save.owner, 'content-type': 'application/json' }, body });
    } catch {
      // offline: the local copy is still there
      if (this.save) localStorage.setItem(`wb.save.${this.save.code}`, JSON.stringify({ owner: this.save.owner, state: e.state, ts: Date.now() }));
    }
  }

  // ================================================================== pause

  private setPaused(p: boolean) {
    this.paused = p;
    this.stage.paused = p;
    this.audio.setPaused(p);
    this.ui.pause(p, this.save?.code);
    if (p) {
      this.audio.stopVoice();
      void this.uploadSave();
    }
    this.pushViews();
  }

  // ================================================================== HUD & phone views

  private hudPlayers(): HudPlayer[] {
    const e = this.engine;
    return this.slots.map((s) => {
      const p = e?.state.players[s.slot];
      return {
        slot: s.slot,
        name: s.name,
        character: s.character,
        color: s.color,
        stars: p?.stars ?? 0,
        coins: p?.coins ?? 0,
        items: p?.items ?? [],
        isBot: s.cpu,
        connected: s.cpu || s.connected,
        chief: this.chief === s.slot,
        active: this.awaiting?.player === s.slot || e?.state.turn?.player === s.slot,
        points: p?.points ?? 0,
        link: s.mode,
      };
    });
  }

  private refreshHud() {
    if (this.phase !== 'game' && this.phase !== 'over') return;
    if (this.runner) return;
    const e = this.engine;
    if (!e) return;
    const title =
      e.state.config.mode === 'board'
        ? `${t('common.round', { round: e.state.round, total: e.state.config.rounds })} · ${t(e.map.nameKey)}`
        : `${t('play.mode.marathon')} · ${Math.min((e.state.marathon?.idx ?? 0) + 1, e.state.marathon?.games.length ?? 10)} / ${e.state.marathon?.games.length ?? 10}`;
    this.ui.setHud(title, this.hudPlayers(), e.state.config.mode);
  }

  private renderGimmickWidget(next?: number[]) {
    const e = this.engine;
    if (!e || e.state.config.mode !== 'board' || this.runner) return this.ui.setGimmick(null);
    const g = e.state.gimmick;
    let el: HTMLElement | null = null;
    if (e.map.gimmick === 'tides') {
      const low = g.tide === 'low';
      const rounds = BALANCE.tideInterval - (e.state.round % BALANCE.tideInterval);
      el = h('div', { class: 'gimmick card' }, h('strong', {}, low ? '🏖️ ' : '🌊 ', t(low ? 'host.tideLow' : 'host.tideHigh')), h('small', {}, ` · ${rounds}↻`));
    } else if (e.map.gimmick === 'eruption') {
      const v = Math.min(g.eruption ?? 0, BALANCE.eruptionThreshold);
      el = h(
        'div',
        { class: 'gimmick card' },
        h('strong', {}, '🌋 ', t('host.eruptionMeter')),
        h('div', { class: 'meter' }, Array.from({ length: BALANCE.eruptionThreshold }, (_, k) => h('span', { class: k < v ? 'on' : '' }))),
      );
    } else if (e.map.gimmick === 'train') {
      const n = e.map.gimmickParams?.trainRoutes?.length ?? 0;
      const idx = g.trainIdx ?? 0;
      const routes = next ?? [0, 1, 2].map((k) => (idx + k) % Math.max(1, n));
      el = h('div', { class: 'gimmick card' }, h('strong', {}, '🚂 ', t('host.timetable')), h('ol', {}, routes.map((r, k) => h('li', { class: k === 0 ? 'next' : '' }, t(`route.${r}`)))));
    }
    this.ui.setGimmick(el);
  }

  private meInfo(s: Slot): MeInfo {
    const p = this.engine?.state.players[s.slot];
    return {
      slot: s.slot,
      name: s.name,
      character: s.character,
      color: s.color,
      coins: p?.coins ?? 0,
      stars: p?.stars ?? 0,
      items: p?.items ?? [],
      tickets: p?.tickets ?? 0,
      starDiscount: p?.starDiscount ?? false,
    };
  }

  private playerInfos(): PlayerInfo[] {
    return this.slots.map((s) => ({ slot: s.slot, name: s.name, character: s.character, color: s.color, isBot: s.cpu, connected: s.connected, chief: this.chief === s.slot }));
  }

  private viewFor(s: Slot): ControllerView {
    const e = this.engine;
    if (this.phase === 'lobby') {
      return {
        screen: 'lobby',
        players: this.playerInfos().filter((p) => !p.isBot || this.resuming),
        settings: this.settings,
        takenCharacters: this.slots.filter((x) => x.character && x !== s).map((x) => x.character!),
        minigames: ALL_MINIGAMES.filter((m) => !m.final).map((m) => ({ id: m.id, format: m.format, motion: !!m.motion })),
        maps: MAP_IDS.map((id) => ({ id, nameKey: MAPS[id].nameKey, descKey: MAPS[id].descKey })),
        canStart: this.canStart(),
        saveCode: this.save?.code ?? null,
      };
    }
    if (this.phase === 'over' && e) {
      const ranking = e.state.ranking ?? [0, 1, 2, 3];
      return {
        screen: 'over',
        place: ranking.indexOf(s.slot) + 1,
        ranking: ranking.map((i) => ({ slot: i, name: e.state.players[i].name, stars: e.state.players[i].stars, coins: e.state.players[i].coins, points: e.state.players[i].points })),
        mode: e.state.config.mode,
        saveCode: this.save?.code ?? null,
      };
    }
    if (this.runner) {
      const r = this.runner;
      const k = r.indexOf(s.slot);
      if (k >= 0) {
        if (r.phase === 'intro') return { screen: 'mgIntro', game: r.def.id, layout: r.layoutFor(s.slot), ready: r.isReady(s.slot), format: r.def.format, team: r.teamOf(s.slot) };
        return { screen: 'mg', game: r.def.id, layout: r.layoutFor(s.slot), team: r.teamOf(s.slot), ended: r.phase === 'done' };
      }
      return { screen: 'wait', message: { key: 'ctrl.watch' } };
    }
    const a = this.awaiting;
    if (a && a.player === s.slot && !this.presenting) {
      const d = this.decisionFor(a.pending);
      if (d) return { screen: 'decide', decision: d };
    }
    const active = e?.state.turn?.player ?? a?.player;
    return { screen: 'wait', activePlayer: active, activeName: active !== undefined ? this.pname(active) : undefined };
  }

  private decisionFor(p: Pending): PhoneDecision | null {
    const e = this.engine!;
    switch (p.kind) {
      case 'orderRoll':
        return { kind: 'orderRoll' };
      case 'turnMenu':
        return { kind: 'turnMenu', canUseItem: p.canUseItem, items: e.state.players[p.player].items.map((id) => ({ id, usable: p.canUseItem && ITEMS[id].usable })), dice: p.dice };
      case 'miniPick':
        return { kind: 'miniPick', options: p.options };
      case 'branch': {
        const from = getField(e.map, e.state.players[p.player].field);
        return {
          kind: 'branch',
          options: p.options.map((id) => {
            const f = getField(e.map, id);
            // screen angle: +x right, +z up on the TV
            const angle = (Math.atan2(f.x - from.x, f.z - from.z) * 180) / Math.PI;
            // show how far the star is along each way (review finding: arrows alone don't help)
            return { id, angle, labelKey: f.tags?.includes('sandbank') || f.tags?.includes('ford') ? 'host.tideLow' : undefined, starDistance: distance(e, id, e.state.starField) + 1 };
          }),
        };
      }
      case 'shop':
        return {
          kind: 'shop',
          offer: p.offer.map((id) => ({ id, price: ITEMS[id].price, affordable: ITEMS[id].price <= e.state.players[p.player].coins })),
          full: e.state.players[p.player].items.length >= BALANCE.maxItems,
          titleKey: e.map.theme === 'city' ? 'play.shopTitle.city' : e.map.theme === 'volcano' ? 'play.shopTitle.volcano' : 'play.shopTitle',
        };
      case 'buyStar':
        return { kind: 'buyStar', price: p.price };
      case 'station':
        return {
          kind: 'station',
          destinations: p.destinations.map((id) => ({ id, labelKey: getField(e.map, id).label ?? 'field.station' })),
          hasTicket: p.hasTicket,
          ticketPrice: p.ticketPrice,
          canBuy: e.state.players[p.player].coins >= p.ticketPrice,
        };
      case 'cablecar':
        return { kind: 'cablecar', price: p.price };
      case 'itemReplace':
        return { kind: 'itemReplace', newItem: p.newItem };
      case 'duelPick':
        return { kind: 'duelPick', options: p.options.map((o) => ({ player: o, name: e.state.players[o].name, character: e.state.players[o].character, coins: e.state.players[o].coins })) };
      case 'wheel':
        return { kind: 'wheel', segments: p.segments };
      default:
        return null;
    }
  }

  pushViews(): void {
    for (const s of this.slots) {
      if (!s.peerId || !s.connected) continue;
      const env: ViewEnvelope = {
        me: this.meInfo(s),
        chief: this.chief === s.slot,
        paused: this.paused,
        round: this.engine && this.phase === 'game' && this.engine.state.config.mode === 'board' ? { round: this.engine.state.round, total: this.engine.state.config.rounds } : undefined,
        afk: this.awaiting?.player === s.slot && this.afkLeft !== null ? { secondsLeft: this.afkLeft } : null,
        view: this.resuming && s.unclaimed !== false && this.phase === 'lobby' ? this.claimEnvelope().view : this.viewFor(s),
      };
      this.send(s, { t: 'view', v: env });
    }
    for (const c of this.pendingClaims.values()) {
      if (this.slots.some((s) => s.token === c.token)) continue;
      if (c.peerId) this.net.send(c.peerId, { t: 'view', v: this.claimEnvelope() });
    }
  }

  /** Bots pick a random free figure, so all 8 characters (and their dice) show up. */
  private randomFreeCharacter(): CharacterId {
    const free = CHARACTERS.filter((c) => !this.slots.some((x) => x.character === c));
    return free[Math.floor(Math.random() * free.length)];
  }

  /** Dev/test hook (window.__wb) */
  debugState() {
    return { phase: this.phase, code: this.net.code, slots: this.slots.map((s) => ({ ...s })), chief: this.chief, game: this.engine?.state ?? null, paused: this.paused, minigame: this.runner?.def.id ?? null, minigamePhase: this.runner?.phase ?? null };
  }

  /** Dev/test hook: speed up presentation (used by automated tests). */
  setFastForward(on: boolean) {
    this.ff = on;
    this.stage.timeScale = this.speed();
  }
}
