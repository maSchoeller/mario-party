/**
 * Phone sensors & device features: motion permission (asked once on join, CTRL-06),
 * tilt/shake sources with fallbacks, wake lock and vibration (CTRL-05).
 */
type PermissionResult = 'granted' | 'denied' | 'unsupported';

interface IOSMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

let motionState: PermissionResult | 'unknown' = 'unknown';

export function motionAvailable(): boolean {
  return motionState === 'granted';
}

/** Must be called from a user gesture (join button). */
export async function requestMotionPermission(): Promise<PermissionResult> {
  try {
    const DOE = (window as unknown as { DeviceOrientationEvent?: IOSMotionEvent }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: IOSMotionEvent }).DeviceMotionEvent;
    if (!DOE && !DME) return (motionState = 'unsupported');
    if (DOE?.requestPermission) {
      const r = await DOE.requestPermission();
      if (DME?.requestPermission) await DME.requestPermission().catch(() => 'denied');
      return (motionState = r === 'granted' ? 'granted' : 'denied');
    }
    // Android/desktop: no prompt; only "granted" if real events arrive
    motionState = await new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('deviceorientation', on);
        resolve('unsupported');
      }, 800);
      const on = (e: DeviceOrientationEvent) => {
        if (e.beta === null && e.gamma === null) return;
        clearTimeout(timer);
        window.removeEventListener('deviceorientation', on);
        resolve('granted');
      };
      window.addEventListener('deviceorientation', on);
    });
    return motionState;
  } catch {
    return (motionState = 'denied');
  }
}

/** Tilt source: calls back with x/y in -1..1 relative to the pose at start. */
export function startTilt(cb: (x: number, y: number) => void): () => void {
  let base: { beta: number; gamma: number } | null = null;
  const on = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    const portrait = window.innerHeight >= window.innerWidth;
    let beta = e.beta;
    let gamma = e.gamma;
    if (!portrait) [beta, gamma] = [-gamma, beta];
    if (!base) base = { beta, gamma };
    const x = Math.max(-1, Math.min(1, (gamma - base.gamma) / 30));
    const y = Math.max(-1, Math.min(1, -(beta - base.beta) / 30));
    cb(x, y);
  };
  window.addEventListener('deviceorientation', on);
  return () => window.removeEventListener('deviceorientation', on);
}

/** Shake source: emits power 0..1 for each detected shake impulse. */
export function startShake(cb: (power: number) => void): () => void {
  let last = 0;
  let prev: { x: number; y: number; z: number } | null = null;
  const on = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const cur = { x: a.x, y: a.y, z: a.z };
    if (prev) {
      const d = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z);
      const now = performance.now();
      if (d > 12 && now - last > 90) {
        last = now;
        cb(Math.min(1, (d - 12) / 25 + 0.3));
      }
    }
    prev = cur;
  };
  window.addEventListener('devicemotion', on);
  return () => window.removeEventListener('devicemotion', on);
}

let wakeLock: { release(): Promise<void> } | null = null;

export async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  if (!nav.wakeLock || wakeLock) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
    (wakeLock as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = null));
  } catch {
    /* not allowed (insecure context / battery saver) */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLockWanted) void keepAwake();
});
let wakeLockWanted = false;
export function wantWakeLock(): void {
  wakeLockWanted = true;
  void keepAwake();
}

let vibrationOn = true;
export function setVibration(on: boolean): void {
  vibrationOn = on;
}
export function vibrate(ms: number | number[]): void {
  if (vibrationOn && 'vibrate' in navigator) navigator.vibrate(ms);
}
