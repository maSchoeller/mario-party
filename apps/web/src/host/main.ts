import '../common/base.css';
import './host.css';
import { HostAudio } from './audio';
import { Stage } from './render/stage';
import { HostSession } from './session';
import { startPerfTelemetry, telemetry } from './telemetry';
import { HostUI } from './ui';

/** TV entry point (/host): Babylon scene + overlay UI + host session (TECH-02). */
const t0 = performance.now();
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const stage = new Stage(canvas);
const ui = new HostUI(document.getElementById('ui')!);
const audio = new HostAudio();
const session = new HostSession(stage, ui, audio);

// audio needs one user gesture; after a reload the first click/key re-enables it
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

void stage.initPhysics().then(() => {
  session.boot();
  telemetry('load_time', { ms: Math.round(performance.now() - t0), physics: !!stage.physics });
});
startPerfTelemetry(() => stage.engine.getFps(), () => stage.qualityLevel);
window.addEventListener('error', (e) => telemetry('error', { msg: String(e.message).slice(0, 150) }));

// debug/test hooks
(window as unknown as Record<string, unknown>).__wb = { session, stage, audio };
