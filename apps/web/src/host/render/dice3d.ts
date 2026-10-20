import { Color3, DynamicTexture, Mesh, Quaternion, StandardMaterial, Vector3, VertexData, type Scene } from '@babylonjs/core';
import { DICE, type DiceId } from '@wb/shared/game/dice';
import type { Stage } from './stage';

/**
 * Real 3D dice (v0.3): rounded cubes with one texture per dice type. A roll is
 * animated as a throw with bounces and tumbling that ends exactly on the face the rules
 * engine rolled – so the number on top is always the number that counts.
 *
 * Face i of a die sits on these cube sides (opposite faces: 0/5, 1/4, 2/3):
 */
const FACE_NORMALS = [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(-1, 0, 0), new Vector3(0, -1, 0)];
const SIZE = 1.15;

export interface DieThrow {
  dice: DiceId;
  face: number;
}

export class DiceRoller {
  private meshes: Mesh[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /**
   * Throws the dice next to `at` (towards the camera) and resolves once they rest.
   * `onBounce` fires on every impact (for the clack sound).
   */
  async roll(at: Vector3, throws: DieThrow[], speed = 1, onBounce?: (strength: number) => void): Promise<void> {
    this.clear();
    const s = this.stage;
    const cam = s.camera.position;
    const toCam = new Vector3(cam.x - at.x, 0, cam.z - at.z).normalize();
    const side = new Vector3(-toCam.z, 0, toCam.x);
    const dur = 1.35 / speed;
    const jobs = throws.map((th, k) => {
      const mesh = dieMesh(s, th.dice);
      this.meshes.push(mesh);
      const spread = (k - (throws.length - 1) / 2) * 1.55;
      const start = at.add(side.scale(spread * 0.6 - 1.2)).add(toCam.scale(0.8));
      const end = at.add(side.scale(spread)).add(toCam.scale(3.4));
      const endY = this.groundY(end.x, end.z) + SIZE / 2;
      // the top label faces the camera (readable from the couch), with a little natural skew
      const qEnd = restingRotation(th.face, toCam.scale(-1), (Math.random() - 0.5) * 0.5);
      const axis1 = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const axis2 = side.add(new Vector3(0, 0.3, 0)).normalize();
      const turns1 = (2 + Math.random() * 2) * Math.PI;
      const turns2 = (3 + Math.random() * 2) * Math.PI;
      const delay = k * 0.07;
      return { mesh, start, end, endY, qEnd, axis1, axis2, turns1, turns2, delay, bounced: 0 };
    });
    // bounce timeline (fractions of the flight): drop, two bounces, settle
    const B = [0, 0.42, 0.68, 0.84, 1];
    const H = [3.6, 1.1, 0.35, 0.08];
    await new Promise<void>((resolve) => {
      let t = 0;
      const stop = s.onUpdate((dt) => {
        t += dt / dur;
        let done = true;
        for (const j of jobs) {
          const u = Math.max(0, Math.min(1, (t - j.delay) / (1 - j.delay * 0.5)));
          if (u < 1) done = false;
          const ease = 1 - (1 - u) ** 3;
          const p = Vector3.Lerp(j.start, j.end, ease);
          // piecewise parabolas between impacts
          let y = j.endY;
          for (let b = 0; b < 4; b++) {
            if (u >= B[b] && u <= B[b + 1]) {
              const k = (u - B[b]) / (B[b + 1] - B[b]);
              y = b === 0 ? j.endY + H[0] * (1 - k * k) : j.endY + H[b] * 4 * k * (1 - k);
              if (b > j.bounced && u > B[b]) {
                j.bounced = b;
                if (j.mesh === jobs[0].mesh) onBounce?.(H[b] / H[1]);
              }
            }
          }
          j.mesh.position.set(p.x, y, p.z);
          // tumbling that unwinds exactly into the resting orientation
          const left = (1 - ease) ** 1.4;
          const q = j.qEnd.multiply(Quaternion.RotationAxis(j.axis1, j.turns1 * left)).multiply(Quaternion.RotationAxis(j.axis2, j.turns2 * left));
          j.mesh.rotationQuaternion = q;
          j.mesh.isVisible = t >= j.delay;
        }
        if (done) {
          stop();
          resolve();
        }
      });
    });
    onBounce?.(0.2);
  }

  /** Little hop + glow of the dice after the result is shown. */
  async celebrate(speed = 1): Promise<void> {
    await this.animate(0.35 / speed, (k) => {
      for (const m of this.meshes) m.scaling.setAll(1 + Math.sin(k * Math.PI) * 0.18);
    });
  }

  /** Shrinks the dice away. */
  async vanish(speed = 1): Promise<void> {
    if (!this.meshes.length) return;
    await this.animate(0.3 / speed, (k) => {
      for (const m of this.meshes) m.scaling.setAll(Math.max(0.001, 1 - k * k));
    });
    this.clear();
  }

  clear(): void {
    for (const m of this.meshes) m.dispose(false, false);
    this.meshes = [];
  }

  private animate(seconds: number, fn: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const stop = this.stage.onUpdate((dt) => {
        t += dt / seconds;
        fn(Math.min(1, t));
        if (t >= 1) {
          stop();
          resolve();
        }
      });
    });
  }
}

/**
 * Orientation that puts face `face` on top with its label's up direction pointing along
 * `away` (horizontal, away from the viewer) plus `skew` radians.
 */
function restingRotation(face: number, away: Vector3, skew: number): Quaternion {
  const n = FACE_NORMALS[face];
  const up = Vector3.Up();
  const axis = Vector3.Cross(n, up);
  const dot = Vector3.Dot(n, up);
  let q: Quaternion;
  if (axis.lengthSquared() < 1e-6) q = dot > 0 ? Quaternion.Identity() : Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  else q = Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, dot))));
  const labelUp = faceFrame(n).v.applyRotationQuaternion(q);
  const yaw = Math.atan2(away.x, away.z) - Math.atan2(labelUp.x, labelUp.z) + skew;
  return Quaternion.RotationAxis(up, yaw).multiply(q);
}

// ------------------------------------------------------------------ geometry + textures

const geoCache = new WeakMap<Scene, VertexData>();

/** Rounded cube; every face maps onto its own cell of a 3×2 atlas. */
function roundedCube(scene: Scene): VertexData {
  const cached = geoCache.get(scene);
  if (cached) return cached;
  const N = 7;
  const R = 0.28;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  FACE_NORMALS.forEach((n, f) => {
    const { u, v } = faceFrame(n);
    const cellX = f % 3;
    const cellY = Math.floor(f / 3);
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * 2 - 1;
        const b = (j / N) * 2 - 1;
        const p = n.add(u.scale(a)).add(v.scale(b));
        const q = new Vector3(clamp(p.x, 1 - R), clamp(p.y, 1 - R), clamp(p.z, 1 - R));
        const d = p.subtract(q);
        const nn = d.lengthSquared() > 1e-9 ? d.normalize() : n;
        const pp = q.add(nn.scale(R)).scale(SIZE / 2);
        pos.push(pp.x, pp.y, pp.z);
        nrm.push(nn.x, nn.y, nn.z);
        // u runs backwards so the labels read correctly from outside the cube
        uv.push((cellX + 1 - i / N) / 3, (cellY + j / N) / 2);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = base + j * (N + 1) + i;
        idx.push(k, k + 1, k + N + 1, k + 1, k + N + 2, k + N + 1);
      }
    }
  });
  // outward facing (Babylon: clockwise front faces seen from outside)
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const e1 = new Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    const e2 = new Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
    const fn = Vector3.Cross(e1, e2);
    const out = new Vector3(pos[a], pos[a + 1], pos[a + 2]);
    if (Vector3.Dot(fn, out) > 0) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  }
  const vd = new VertexData();
  Object.assign(vd, { positions: pos, normals: nrm, uvs: uv, indices: idx });
  geoCache.set(scene, vd);
  return vd;
}

/** Tangent frame of a cube face; +v is the "up" direction of the face label. */
function faceFrame(n: Vector3): { u: Vector3; v: Vector3 } {
  const u = Math.abs(n.y) > 0.5 ? new Vector3(1, 0, 0) : Vector3.Cross(Vector3.Up(), n).normalize();
  return { u, v: Vector3.Cross(n, u).normalize() };
}

function clamp(x: number, m: number): number {
  return Math.max(-m, Math.min(m, x));
}

const matCache = new WeakMap<Scene, Map<DiceId, StandardMaterial>>();

export function diceMaterial(scene: Scene, id: DiceId): StandardMaterial {
  let m = matCache.get(scene);
  if (!m) matCache.set(scene, (m = new Map()));
  const hit = m.get(id);
  if (hit) return hit;
  const def = DICE[id];
  const C = 256;
  const tex = new DynamicTexture(`dice_${id}`, { width: C * 3, height: C * 2 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = def.color;
  ctx.fillRect(0, 0, C * 3, C * 2);
  def.faces.forEach((face, f) => {
    // DynamicTexture is flipped vertically relative to the uv cells
    const cx = (f % 3) * C + C / 2;
    const cy = (1 - Math.floor(f / 3)) * C + C / 2;
    // soft inset panel
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, cx - C * 0.36, cy - C * 0.36, C * 0.72, C * 0.72, 36);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const neg = face.steps < 0;
    ctx.fillStyle = neg ? '#ff6b6b' : def.ink;
    ctx.font = `900 ${face.coins ? 120 : 150}px Nunito, sans-serif`;
    ctx.fillText(String(face.steps), cx, cy + (face.coins ? -20 : 6));
    if (face.coins) {
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.arc(cx, cy + 68, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b8901d';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = '#6b4e0e';
      ctx.font = `900 40px Nunito, sans-serif`;
      ctx.fillText(`+${face.coins}`, cx, cy + 70);
    }
  });
  tex.update();
  const mat = new StandardMaterial(`diceMat_${id}`, scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.35, 0.35, 0.35);
  mat.specularPower = 48;
  mat.emissiveColor = new Color3(0.12, 0.12, 0.12);
  m.set(id, mat);
  return mat;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dieMesh(stage: Stage, id: DiceId): Mesh {
  const m = new Mesh(`die_${id}`, stage.scene);
  roundedCube(stage.scene).applyToMesh(m);
  m.material = diceMaterial(stage.scene, id);
  m.isPickable = false;
  m.isVisible = false;
  stage.castShadow(m, false);
  return m;
}
