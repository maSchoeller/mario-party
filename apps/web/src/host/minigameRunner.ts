import { BALANCE } from '@wb/shared/config';
import type { Pending } from '@wb/shared/game/types';
import { t } from '@wb/shared/i18n/index';
import { getMinigame } from '@wb/shared/minigames/registry';
import type { ControllerLayout, MgInput, MgPlayer, MinigameDef } from '@wb/shared/minigames/types';
import { Rng } from '@wb/shared/rng';
import { Vector3 } from '@babylonjs/core';
import { burst } from './render/mgFx';
import { scenerySound } from './render/mgScenery';
import type { HostAudio, MusicKey } from './audio';
import { MinigameView } from './render/minigameView';
import type { Stage } from './render/stage';
import type { HostUI } from './ui';

/**
 * Runs one minigame on the host (TECH-03): explanation screen with practice phase
 * (MINI-04), countdown, fixed-step simulation at 60 Hz with bots (BOT-03), results.
 */
export interface RunnerHooks {
  isBot(gameIdx: number): boolean;
  botLevel(gameIdx: number): MgPlayer['botLevel'];
  playerInfo(gameIdx: number): { name: string; character: MgPlayer['character']; color: MgPlayer['color'] };
  pushViews(): void;
  isPaused(): boolean;
  speed(): number;
  telemetry(name: string, props: Record<string, string | number>): void;
}

type Phase = 'intro' | 'countdown' | 'play' | 'done';

export class MinigameRunner {
  readonly def: MinigameDef;
  readonly players: MgPlayer[];
  phase: Phase = 'intro';
  private state: unknown;
  private view: MinigameView;
  private rng: Rng;
  private botRng: Rng;
  private ready: boolean[];
  private simTime = 0;
  private lastTickWall = performance.now();
  private stopUpdate: (() => void) | null = null;
  private acc = 0;
  private resolveDone: ((ranks: number[]) => void) | null = null;
  private introLeft: number = BALANCE.minigameReadyTimeoutSec;
  private hudTimer = 0;
  private lastLayouts: string[] = [];
  private prevLit: unknown = null;

  constructor(
    private readonly stage: Stage,
    private readonly ui: HostUI,
    private readonly audio: HostAudio,
    readonly pending: Extract<Pending, { kind: 'minigame' }>,
    seed: number,
    private readonly hooks: RunnerHooks,
  ) {
    this.def = getMinigame(pending.game);
    this.players = pending.players.map((gi, k) => {
      const info = hooks.playerInfo(gi);
      return { idx: k, gameIdx: gi, team: pending.teams[k], character: info.character, color: info.color, isBot: hooks.isBot(gi), botLevel: hooks.botLevel(gi) };
    });
    this.rng = Rng.fromSeed(seed);
    this.botRng = Rng.fromSeed(seed ^ 0x5bd1e995);
    this.ready = this.players.map((p) => p.isBot);
    this.view = new MinigameView(stage, this.players);
    this.view.onSound = (sfx, pan, gain) => this.audio.mgSfx(sfx, pan, gain);
    this.state = this.def.setup(this.players, this.rng, { practice: true });
  }

  /** Index inside this minigame for a game player, or -1. */
  indexOf(gameIdx: number): number {
    return this.players.findIndex((p) => p.gameIdx === gameIdx);
  }

  /**
   * Starts the minigame (the caller has closed the iris over the board): builds the
   * backdrop, flies the camera in from a wide angle while the iris opens, music sits softer
   * under the explanation and the ambience of the backdrop fades in (v0.4).
   */
  run(): Promise<number[]> {
    const moods: MusicKey[] = ['minigame', 'minigame2', 'minigame3'];
    this.audio.playMusic(moods[Math.abs(hash(this.def.id)) % moods.length]);
    this.audio.musicShape(0.55, false, 1.2);
    const first = this.def.view(this.state as never);
    this.view.render(first, 0.0001);
    this.audio.ambience(first.scenery ? scenerySound(first.scenery.set) : null);
    // camera fly-in: start high and wide, glide down onto the game camera
    const c = first.camera;
    this.stage.setCamera({ alpha: c.alpha + 0.75, beta: Math.max(0.35, c.beta - 0.45), radius: c.radius * 2.1, target: new Vector3(c.target[0], c.target[1] + 2, c.target[2] + 4) }, 1, true);
    this.view.cameraSpeed = 0.9;
    setTimeout(() => (this.view.cameraSpeed = 3), 2600 / this.hooks.speed());
    void this.ui.iris('open', 700 / this.hooks.speed());
    void this.audio.say('mod.minigameTitle', { game: `mg.${this.def.id}.name` }, 900);
    this.stopUpdate = this.stage.onUpdate(() => this.frame());
    this.lastTickWall = performance.now();
    return new Promise((resolve) => (this.resolveDone = resolve));
  }

  setReady(gameIdx: number): void {
    const k = this.indexOf(gameIdx);
    if (k < 0 || this.phase !== 'intro') return;
    this.ready[k] = true;
    this.audio.sfx('ding');
    this.hooks.pushViews();
  }

  isReady(gameIdx: number): boolean {
    const k = this.indexOf(gameIdx);
    return k >= 0 && this.ready[k];
  }

  /** Player became bot (disconnect) or human again (reconnect). */
  refreshBots(): void {
    this.players.forEach((p) => {
      p.isBot = this.hooks.isBot(p.gameIdx);
      p.botLevel = this.hooks.botLevel(p.gameIdx);
      if (p.isBot) this.ready[p.idx] = true;
    });
  }

  input(gameIdx: number, input: MgInput): void {
    const k = this.indexOf(gameIdx);
    if (k < 0 || this.players[k].isBot) return;
    if (this.phase !== 'intro' && this.phase !== 'play') return;
    let inp = input;
    if (inp.type === 'press') {
      // host clock ms (from the phone's synchronized clock) -> minigame seconds (NET-05)
      const sec = this.simTime + (inp.t - this.lastTickWall) / 1000;
      inp = { type: 'press', t: Math.max(0, Math.min(this.simTime + 0.05, sec)) };
    }
    this.def.input(this.state as never, k, inp);
  }

  layoutFor(gameIdx: number): ControllerLayout {
    const k = this.indexOf(gameIdx);
    if (k < 0) return { kind: 'wait', labelKey: 'ctrl.watch' };
    if (this.phase === 'countdown' || this.phase === 'done') return { kind: 'wait', labelKey: 'ctrl.watch' };
    return this.def.layout(this.state as never, k);
  }

  teamOf(gameIdx: number): number {
    const k = this.indexOf(gameIdx);
    return k >= 0 ? this.players[k].team : -1;
  }

  private frame() {
    const now = performance.now();
    if (this.hooks.isPaused()) {
      this.lastTickWall = now;
      return;
    }
    let realDt = Math.min(0.1, (now - this.lastTickWall) / 1000);
    this.lastTickWall = now;
    if (this.phase === 'intro') {
      this.introLeft -= realDt;
      if (this.ready.every(Boolean) || this.introLeft <= 0) void this.startMain();
    }
    if (this.phase === 'intro' || this.phase === 'play') {
      this.acc += realDt;
      const step = 1 / 60;
      let steps = 0;
      while (this.acc >= step && steps < 8) {
        this.tick(step);
        this.acc -= step;
        steps++;
      }
    }
    realDt = Math.max(realDt, 0.0001);
    const v = this.def.view(this.state as never);
    this.view.render(v, realDt);
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      if (this.phase === 'intro') {
        this.ui.minigameIntro(
          this.def.id,
          this.def.format,
          this.players,
          this.players.map((p) => this.hooks.playerInfo(p.gameIdx).name),
          this.ready,
          this.introLeft,
          this.players.map((p) => this.teamLabel(p.team)),
          [...new Set(this.players.map((p) => this.def.layout(this.state as never, p.idx).kind))],
        );
        this.ui.mgHud(null, this.players, '');
      } else if (this.phase === 'play') {
        this.ui.mgHud(v.hud, this.players, `${t(`mg.${this.def.id}.name`)} · ${t(`format.${this.def.format}`)}`);
      }
      // phones follow layout changes (e.g. role switch, locked choice)
      const layouts = this.players.map((p) => JSON.stringify(this.layoutFor(p.gameIdx)));
      if (layouts.some((l, i) => l !== this.lastLayouts[i])) {
        this.lastLayouts = layouts;
        this.hooks.pushViews();
      }
    }
    // memo-style games expose the lit pad – play a tone (AUDIO-02)
    const lit = (this.state as { lit?: number | null; litStep?: number }).litStep;
    if (lit !== undefined && lit !== this.prevLit) {
      this.prevLit = lit;
      const pad = (this.state as { lit?: number | null }).lit;
      if (pad !== null && pad !== undefined) this.audio.sfx(`pad${pad}` as 'pad0');
    }
  }

  private teamLabel(team: number): string {
    if (this.def.format === '2v2') return t(team === 0 ? 'team.red' : 'team.blue');
    if (this.def.format === '1v3') return t(team === 0 ? 'team.solo' : 'team.trio');
    return '';
  }

  private tick(dt: number) {
    for (const p of this.players) {
      if (!p.isBot) continue;
      for (const inp of this.def.bot(this.state as never, p.idx, p.botLevel, this.botRng, dt)) this.def.input(this.state as never, p.idx, inp);
    }
    this.def.tick(this.state as never, dt, this.rng);
    this.simTime += dt;
    if (this.phase === 'intro' && this.def.isOver(this.state as never)) {
      // practice should never end, but be safe
      this.state = this.def.setup(this.players, this.rng, { practice: true });
      this.simTime = 0;
    }
    if (this.phase === 'play' && this.def.isOver(this.state as never)) void this.finish();
  }

  private async startMain() {
    if (this.phase !== 'intro') return;
    this.phase = 'countdown';
    this.ui.setOverlay(null);
    this.state = this.def.setup(this.players, this.rng, { practice: false });
    this.simTime = 0;
    this.hooks.pushViews();
    // the camera settles on the game camera during the count
    this.view.cameraSpeed = 2;
    this.audio.musicShape(0.42, false, 0.4);
    for (const n of [3, 2, 1]) {
      this.ui.countdown(n);
      this.audio.countdownTick(n);
      await this.wait(700);
    }
    this.ui.countdown(t('host.mgGo'));
    this.audio.countdownTick(0);
    this.audio.musicShape(1, false, 0.25);
    this.view.cameraSpeed = 3;
    this.phase = 'play';
    this.acc = 0;
    this.lastTickWall = performance.now();
    this.hooks.pushViews();
    setTimeout(() => this.ui.countdown(null), 600);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => {
      const check = () => (this.hooks.isPaused() ? setTimeout(check, 100) : setTimeout(r, ms));
      check();
    });
  }

  private async finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const ranks = this.def.result(this.state as never);
    this.hooks.pushViews();
    // final whistle: the music drops muffled, "SCHLUSS!" slams in
    this.audio.stinger('whistle');
    this.audio.musicShape(0.45, true, 0.35);
    this.ui.mgHud(null, this.players, '');
    this.ui.countdown(t('host.mgFinish'), 'finish');
    this.hooks.telemetry('minigame_result', { game: this.def.id, format: this.def.format, seconds: Math.round(this.simTime), bots: this.players.filter((p) => p.isBot).length });
    await this.wait(950);
    this.ui.countdown(null);
    // winners cheer under confetti, the camera leans in on them, then the fanfare
    this.view.setCelebration(ranks);
    const winners = ranks.map((r, i) => (r === 0 ? this.view.playerPos(i) : null)).filter((p): p is Vector3 => !!p);
    if (winners.length && winners.length < this.players.length) {
      const mid = winners.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / winners.length);
      for (const w of winners) burst(this.stage, 'confetti', w.add(new Vector3(0, 2.6, 0)));
      const cam = this.stage.camera;
      this.view.cameraSpeed = 1.6;
      this.stage.setCamera({ target: mid.add(new Vector3(0, 1.2, 0)), radius: Math.max(9, cam.radius * 0.55), beta: Math.min(1.25, cam.beta + 0.12) }, 1.6);
      this.view.followCamera = false;
    }
    this.audio.mgSfx('cheer', 0, 0.9);
    this.audio.musicShape(0.7, false, 0.8);
    this.audio.sfx('fanfare');
    await this.wait(1500);
    this.resolveDone?.(ranks);
  }

  dispose(): void {
    this.stopUpdate?.();
    this.view.dispose();
    this.ui.mgHud(null, this.players, '');
    this.ui.countdown(null);
  }
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
