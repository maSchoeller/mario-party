import { TransformNode, Vector3, type Mesh } from '@babylonjs/core';
import { PLAYER_COLOR_HEX, type CharacterId, type PlayerColor } from '@wb/shared/config';
import { cone, cyl, flat, sphere, starMesh, box } from './props';
import type { Stage } from './stage';

/**
 * Procedural low-poly heroes (placeholder for the AI/Blender pipeline, ASSET-02).
 * Each figure has a distinct silhouette (ART-03) and a colored base whose *shape*
 * also encodes the player color (ART-07): ● red, ▲ blue, ■ green, ◆ yellow.
 * Animations (ART-02) are procedural: idle, walk, jump, cheer, sad, hit, roll.
 */
export type Anim = 'idle' | 'walk' | 'jump' | 'cheer' | 'sad' | 'hit' | 'roll';

interface Look {
  body: string;
  belly: string;
  dark: string;
  accent: string;
}

const LOOKS: Record<CharacterId | 'moderator', Look> = {
  rocco: { body: '#a3a1b0', belly: '#ecebf2', dark: '#3d3a4a', accent: '#6c6a7a' },
  quaki: { body: '#7cc56f', belly: '#d8efc5', dark: '#2f4a2b', accent: '#f2c94c' },
  pingo: { body: '#2f3552', belly: '#f1f0f4', dark: '#1b1e2e', accent: '#e8676b' },
  foxy: { body: '#f0a050', belly: '#fbf1e4', dark: '#3a2a22', accent: '#f6c08a' },
  moderator: { body: '#5cc08a', belly: '#f2c94c', dark: '#2b2b3a', accent: '#e8676b' },
};

export class CharacterRig {
  readonly root: TransformNode;
  private body: TransformNode;
  private head: TransformNode;
  private armL: TransformNode;
  private armR: TransformNode;
  base: Mesh | null = null;
  anim: Anim = 'idle';
  private t = Math.random() * 10;
  private animT = 0;
  private emojiTimer = 0;

  constructor(
    private readonly stage: Stage,
    readonly character: CharacterId | 'moderator',
    readonly color: PlayerColor | null,
    name: string,
  ) {
    const s = stage;
    const look = LOOKS[character];
    this.root = new TransformNode(name, s.scene);
    this.body = new TransformNode(`${name}_body`, s.scene);
    this.body.parent = this.root;
    this.head = new TransformNode(`${name}_head`, s.scene);
    this.head.parent = this.body;
    this.head.position.y = 1.15;

    this.armL = new TransformNode(`${name}_armL`, s.scene);
    this.armR = new TransformNode(`${name}_armR`, s.scene);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.parent = this.body;
      arm.position.set(side * 0.48, 0.8, 0);
    }
    // Blender model (ASSET-02) if loaded, else the procedural placeholder
    if (s.assets.has(character, 'body')) {
      const lib = s.assets;
      lib.attach(character, 'body', this.body);
      lib.attach(character, 'head', this.head, { offset: this.head.position });
      lib.attach(character, 'armL', this.armL, { offset: this.armL.position });
      lib.attach(character, 'armR', this.armR, { offset: this.armR.position });
    } else this.buildProcedural(name, look);

    // player base: color + shape (ART-07)
    if (color) {
      const tess = { red: 16, blue: 3, green: 4, yellow: 4 }[color];
      const b = cyl(s, `${name}_base`, { d: 1.35, h: 0.12, tess }, PLAYER_COLOR_HEX[color], this.root);
      b.position.y = 0.06;
      if (color === 'green') b.rotation.y = Math.PI / 4;
      if (color === 'blue') b.rotation.y = Math.PI;
      this.base = b;
    }
    for (const m of this.root.getChildMeshes()) s.castShadow(m, false);
  }

  private buildProcedural(name: string, look: Look) {
    const s = this.stage;
    const character = this.character;
    // torso
    const torso = sphere(s, `${name}_torso`, 1.05, look.body, 5, this.body);
    torso.scaling.set(1, 1.05, 0.9);
    torso.position.y = 0.6;
    const belly = sphere(s, `${name}_belly`, 0.75, look.belly, 4, this.body);
    belly.scaling.set(1, 1.1, 0.6);
    belly.position.set(0, 0.55, -0.25);
    // feet
    for (const side of [-1, 1]) {
      const foot = sphere(s, `${name}_foot${side}`, 0.36, character === 'pingo' ? '#f4a259' : look.dark, 3, this.body);
      foot.scaling.set(1, 0.55, 1.3);
      foot.position.set(side * 0.26, 0.1, -0.12);
    }
    // arms
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      const a = sphere(s, `${name}_arm${side}`, 0.32, look.body, 3, arm);
      a.scaling.set(0.8, 1.4, 0.8);
      a.position.y = -0.18;
    }
    // head
    const headMesh = sphere(s, `${name}_headm`, 0.9, look.body, 5, this.head);
    headMesh.scaling.set(1.05, 0.92, 0.95);
    const muzzle = sphere(s, `${name}_muzzle`, 0.42, look.belly, 3, this.head);
    muzzle.scaling.set(1.1, 0.75, 0.8);
    muzzle.position.set(0, -0.12, -0.36);
    this.eyes(name, look, character === 'quaki' ? 0.32 : 0.12, character === 'quaki' ? 0.55 : 0.4);
    // cheeks
    for (const side of [-1, 1]) {
      const cheek = sphere(s, `${name}_cheek${side}`, 0.14, '#f3a3b0', 3, this.head);
      cheek.position.set(side * 0.3, -0.12, -0.36);
      cheek.scaling.z = 0.4;
    }
    this.decorate(name, this.character, look);
  }

  private eyes(name: string, look: Look, y: number, spread: number) {
    const s = this.stage;
    for (const side of [-1, 1]) {
      const white = sphere(s, `${name}_eye${side}`, this.character === 'quaki' ? 0.32 : 0.22, '#ffffff', 3, this.head);
      white.position.set((side * spread) / 2, y, this.character === 'quaki' ? -0.22 : -0.38);
      const pupil = sphere(s, `${name}_pupil${side}`, 0.12, '#1d1b2a', 3, this.head);
      pupil.position.set((side * spread) / 2, y, (this.character === 'quaki' ? -0.22 : -0.38) - 0.11);
    }
    void look;
  }

  private decorate(name: string, c: CharacterId | 'moderator', look: Look) {
    const s = this.stage;
    const h = this.head;
    switch (c) {
      case 'rocco': {
        // bandit mask + round ears + ringed tail
        const mask = box(s, `${name}_mask`, 0.82, 0.18, 0.2, look.dark, h);
        mask.position.set(0, 0.12, -0.33);
        for (const side of [-1, 1]) {
          const ear = cone(s, `${name}_ear${side}`, 0.3, 0.32, look.accent, 4, h);
          ear.position.set(side * 0.3, 0.42, 0);
          ear.rotation.z = -side * 0.3;
        }
        const tail = new TransformNode(`${name}_tail`, s.scene);
        tail.parent = this.body;
        tail.position.set(0, 0.4, 0.45);
        tail.rotation.x = 1.0;
        for (let i = 0; i < 4; i++) {
          const ring = cyl(s, `${name}_tail${i}`, { d: 0.3 - i * 0.03, h: 0.2, tess: 6 }, i % 2 ? look.dark : look.body, tail);
          ring.position.y = i * 0.2;
        }
        break;
      }
      case 'quaki': {
        const crown = cyl(s, `${name}_crown`, { top: 0.36, bottom: 0.3, h: 0.18, tess: 5 }, '#f2c94c', h);
        crown.position.y = 0.48;
        crown.material = s.mat('#f2c94c', { emissive: 0.3 });
        for (let i = 0; i < 5; i++) {
          const spike = cone(s, `${name}_spike${i}`, 0.1, 0.14, '#f2c94c', 4, h);
          const a = (i / 5) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.15, 0.62, Math.sin(a) * 0.15);
        }
        const mouth = box(s, `${name}_mouth`, 0.42, 0.04, 0.05, look.dark, h);
        mouth.position.set(0, -0.14, -0.47);
        break;
      }
      case 'pingo': {
        const beak = cone(s, `${name}_beak`, 0.2, 0.28, '#f4a259', 4, h);
        beak.rotation.x = -Math.PI / 2;
        beak.position.set(0, -0.05, -0.55);
        const scarf = flat(cyl(s, `${name}_scarf`, { d: 0.95, h: 0.16, tess: 10 }, look.accent, this.body));
        scarf.position.y = 1.0;
        const tailEnd = box(s, `${name}_scarfEnd`, 0.16, 0.42, 0.06, look.accent, this.body);
        tailEnd.position.set(0.24, 0.82, -0.4);
        tailEnd.rotation.z = 0.25;
        break;
      }
      case 'foxy': {
        for (const side of [-1, 1]) {
          const ear = cone(s, `${name}_ear${side}`, 0.32, 0.5, look.body, 4, h);
          ear.position.set(side * 0.26, 0.5, 0.02);
          ear.rotation.z = -side * 0.2;
          const tip = cone(s, `${name}_eartip${side}`, 0.14, 0.18, look.dark, 4, h);
          tip.position.set(side * 0.3, 0.72, 0.02);
          tip.rotation.z = -side * 0.2;
        }
        const nose = sphere(s, `${name}_nose`, 0.1, look.dark, 2, h);
        nose.position.set(0, -0.08, -0.55);
        const tail = cone(s, `${name}_tail`, 0.5, 1.0, look.body, 6, this.body);
        tail.rotation.x = -2.2;
        tail.position.set(0, 0.45, 0.55);
        const tip = sphere(s, `${name}_tailtip`, 0.32, look.belly, 3, this.body);
        tip.position.set(0, 0.85, 0.98);
        break;
      }
      case 'moderator': {
        // parrot: beak, feather crest, colorful wings
        const beak = cone(s, `${name}_beak`, 0.28, 0.36, '#f2c94c', 4, h);
        beak.rotation.x = -Math.PI / 2 - 0.4;
        beak.position.set(0, -0.12, -0.55);
        for (let i = 0; i < 3; i++) {
          const f = cone(s, `${name}_crest${i}`, 0.14, 0.45, i === 1 ? '#e8676b' : '#5f8fe0', 4, h);
          f.position.set((i - 1) * 0.12, 0.55, 0.05);
          f.rotation.z = (1 - i) * 0.3;
        }
        const hat = cyl(s, `${name}_hat`, { top: 0.6, bottom: 0.7, h: 0.22, tess: 6 }, '#3d3a55', h);
        hat.position.set(0, 0.42, 0.05);
        break;
      }
    }
  }

  setAnim(a: Anim): void {
    if (a !== this.anim) {
      this.anim = a;
      this.animT = 0;
    }
  }

  setPosition(p: Vector3): void {
    this.root.position.copyFrom(p);
  }

  /** Called every frame. */
  update(dt: number): void {
    this.t += dt;
    this.animT += dt;
    const t = this.t;
    const b = this.body;
    b.position.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    b.scaling.setAll(1);
    this.head.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    switch (this.anim) {
      case 'idle':
        b.scaling.y = 1 + Math.sin(t * 2.4) * 0.03;
        this.head.rotation.z = Math.sin(t * 1.3) * 0.05;
        this.armL.rotation.z = 0.15 + Math.sin(t * 2.4) * 0.05;
        this.armR.rotation.z = -0.15 - Math.sin(t * 2.4) * 0.05;
        break;
      case 'walk': {
        const p = t * 11;
        b.position.y = Math.abs(Math.sin(p)) * 0.22;
        b.rotation.z = Math.sin(p) * 0.08;
        this.armL.rotation.x = Math.sin(p) * 0.7;
        this.armR.rotation.x = -Math.sin(p) * 0.7;
        break;
      }
      case 'jump': {
        const p = (this.animT % 0.8) / 0.8;
        b.position.y = Math.sin(p * Math.PI) * 1.2;
        b.scaling.y = 1 + Math.sin(p * Math.PI * 2) * 0.08;
        this.armL.rotation.z = 1.2;
        this.armR.rotation.z = -1.2;
        break;
      }
      case 'cheer': {
        const p = t * 8;
        b.position.y = Math.abs(Math.sin(p)) * 0.5;
        this.armL.rotation.z = 2.6 + Math.sin(p) * 0.3;
        this.armR.rotation.z = -2.6 - Math.sin(p) * 0.3;
        b.rotation.y = Math.sin(t * 3) * 0.3;
        break;
      }
      case 'sad':
        this.head.rotation.x = 0.45;
        b.scaling.y = 0.94;
        this.armL.rotation.z = 0.05;
        this.armR.rotation.z = -0.05;
        b.rotation.y = Math.sin(t * 1.5) * 0.1;
        break;
      case 'hit': {
        const p = Math.min(1, this.animT / 0.6);
        b.rotation.y = p * Math.PI * 4;
        b.scaling.y = 0.8 + p * 0.2;
        b.position.y = Math.sin(p * Math.PI) * 0.4;
        break;
      }
      case 'roll':
        b.rotation.x = t * 10;
        b.position.y = 0.5;
        break;
    }
    if (this.emojiTimer > 0) this.emojiTimer -= dt;
  }

  dispose(): void {
    this.root.dispose(false, false);
  }
}

/** A small star prop used for moderator/bonus scenes. */
export function bigStar(stage: Stage, name: string, size = 2.2): TransformNode {
  const root = new TransformNode(name, stage.scene);
  const st = starMesh(stage, `${name}_m`, size, '#f2c94c', root);
  st.position.y = size * 0.6;
  stage.castShadow(st, false);
  stage.glow.addIncludedOnlyMesh?.(st);
  return root;
}

export function lookAtYaw(from: Vector3, to: Vector3): number {
  // models face -z at rotation 0
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
