import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GlowLayer,
  HavokPlugin,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core';
import { AssetLibrary } from './assets';

/**
 * Babylon engine + scene setup (TECH-01): WebGL2, Havok physics for visual effects,
 * soft shadows, gentle fog and a gradient sky (ART-04). Quality is lowered
 * automatically when the frame rate drops (PERF-01).
 */
export interface CameraGoal {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
}

export class Stage {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly sun: DirectionalLight;
  readonly shadows: ShadowGenerator;
  readonly glow: GlowLayer;
  physics: HavokPlugin | null = null;
  readonly assets: AssetLibrary = new AssetLibrary(this);
  private goal: CameraGoal | null = null;
  private camSpeed = 2.5;
  private shake = 0;
  private matCache = new Map<string, StandardMaterial>();
  private quality = 2;
  private sky: Mesh;
  private fpsSamples: number[] = [];
  private updaters = new Set<(dt: number) => void>();
  timeScale = 1;
  paused = false;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.62, 0.83, 0.93, 1);
    scene.ambientColor = new Color3(0.22, 0.22, 0.26);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.004;
    scene.fogColor = new Color3(0.81, 0.91, 0.95);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.85, 60, Vector3.Zero(), scene);
    this.camera.fov = 0.8;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 600;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), scene);
    hemi.intensity = 0.5;
    hemi.groundColor = new Color3(0.55, 0.55, 0.65);
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.55), scene);
    this.sun.position = new Vector3(40, 80, -50);
    this.sun.intensity = 0.72;
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 24;
    this.shadows.darkness = 0.45;
    this.glow = new GlowLayer('glow', scene, { blurKernelSize: 32 });
    this.glow.intensity = 0.6;
    // gentle grading: a touch of contrast and a soft vignette for the TV look
    const ip = scene.imageProcessingConfiguration;
    ip.isEnabled = true;
    ip.contrast = 1.1;
    ip.exposure = 1.04;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.6;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor.set(0.12, 0.1, 0.2, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    this.sky = this.buildSky();

    // ?quality=0 forces the lowest quality (software rendering in automated tests)
    const q = new URLSearchParams(location.search).get('quality');
    if (q === '0') {
      // automated tests on software rendering (CI): render as little as possible so the
      // main thread stays free for the game logic and timers
      this.quality = 0;
      this.shadows.getShadowMap()!.refreshRate = 0;
      this.glow.isEnabled = false;
      scene.imageProcessingConfiguration.vignetteEnabled = false;
      this.engine.setHardwareScalingLevel(3);
    }
    scene.onBeforeRenderObservable.add(() => this.update());
    this.engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => this.engine.resize());
  }

  async initPhysics(): Promise<void> {
    try {
      const { default: HavokPhysics } = await import('@babylonjs/havok');
      const wasmUrl = (await import('@babylonjs/havok/lib/esm/HavokPhysics.wasm?url')).default;
      const havok = await HavokPhysics({ locateFile: () => wasmUrl });
      this.physics = new HavokPlugin(true, havok);
      this.scene.enablePhysics(new Vector3(0, -18, 0), this.physics);
    } catch (err) {
      console.warn('Havok unavailable – physics effects disabled', err);
    }
  }

  onUpdate(fn: (dt: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  private update() {
    const rawDt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    const dt = this.paused ? 0 : rawDt * this.timeScale;
    for (const fn of this.updaters) fn(dt);
    // camera easing
    if (this.goal) {
      const k = 1 - Math.exp(-this.camSpeed * rawDt);
      const c = this.camera;
      c.alpha += (this.goal.alpha - c.alpha) * k;
      c.beta += (this.goal.beta - c.beta) * k;
      c.radius += (this.goal.radius - c.radius) * k;
      // copy in place: the `target` setter would rebuild alpha/beta/radius from the old position
      c.target.copyFrom(Vector3.Lerp(c.target, this.goal.target, k));
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - rawDt);
      const s = this.shake * 0.6;
      this.camera.target.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.adaptQuality(rawDt);
  }

  /** Lowers shadow quality / resolution if fps stays below ~45 (PERF-01). */
  private adaptQuality(dt: number) {
    if (dt <= 0) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length < 180) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples = [];
    if (avg < 45 && this.quality > 0) {
      this.quality--;
      if (this.quality === 1) {
        this.shadows.blurKernel = 8;
        this.glow.isEnabled = false;
      } else {
        this.shadows.getShadowMap()?.renderList?.splice(0);
        this.engine.setHardwareScalingLevel(1.4);
      }
    }
  }

  get qualityLevel(): number {
    return this.quality;
  }

  setCamera(goal: Partial<CameraGoal> & { target?: Vector3 }, speed = 2.5, instant = false): void {
    const c = this.camera;
    this.goal = {
      alpha: goal.alpha ?? this.goal?.alpha ?? c.alpha,
      beta: goal.beta ?? this.goal?.beta ?? c.beta,
      radius: goal.radius ?? this.goal?.radius ?? c.radius,
      target: goal.target?.clone() ?? this.goal?.target ?? c.target.clone(),
    };
    this.camSpeed = speed;
    if (instant) {
      c.alpha = this.goal.alpha;
      c.beta = this.goal.beta;
      c.radius = this.goal.radius;
      c.target.copyFrom(this.goal.target);
    }
  }

  shakeCamera(seconds: number): void {
    this.shake = Math.max(this.shake, seconds);
  }

  /** Flat-ish pastel material, cached by color (ART-04/05). */
  mat(hex: string, opts: { emissive?: number; alpha?: number } = {}): StandardMaterial {
    const key = `${hex}|${opts.emissive ?? 0}|${opts.alpha ?? 1}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new StandardMaterial(`m_${key}`, this.scene);
      const c = Color3.FromHexString(hex);
      m.diffuseColor = c;
      m.specularColor = new Color3(0.06, 0.06, 0.06);
      m.ambientColor = c.scale(0.3);
      if (opts.emissive) m.emissiveColor = c.scale(opts.emissive);
      if (opts.alpha !== undefined && opts.alpha < 1) {
        m.alpha = opts.alpha;
      }
      m.freeze();
      this.matCache.set(key, m);
    }
    return m;
  }

  castShadow(mesh: AbstractMesh, recursive = true): void {
    if (this.quality === 0) return;
    this.shadows.addShadowCaster(mesh, recursive);
  }

  receiveShadow(mesh: Mesh | AbstractMesh): void {
    mesh.receiveShadows = true;
  }

  /** Gradient dome around everything (vertex colors set per map in setSky). */
  private buildSky(): Mesh {
    const dome = MeshBuilder.CreateSphere('sky', { diameter: 1000, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const mat = new StandardMaterial('skyMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
    return dome;
  }

  setSky(top: string, bottom: string, fog: string): void {
    const b = Color3.FromHexString(top);
    this.scene.clearColor = new Color4(b.r, b.g, b.b, 1);
    // zenith = top, horizon = fog color (matches the distant board), below = bottom
    const zen = Color3.FromHexString(top);
    const hor = Color3.FromHexString(fog);
    const low = Color3.FromHexString(bottom);
    const pos = this.sky.getVerticesData('position')!;
    const col: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1] / 500;
      const c = y > 0 ? Color3.Lerp(hor, zen, Math.pow(y, 0.55)) : Color3.Lerp(hor, low, Math.min(1, -y * 3));
      col.push(c.r, c.g, c.b, 1);
    }
    this.sky.setVerticesData('color', col);
    this.sky.useVertexColors = true;
    this.scene.fogColor = Color3.FromHexString(fog);
    document.body.style.setProperty('--sky-top', top);
    document.body.style.setProperty('--sky-bottom', bottom);
  }
}
