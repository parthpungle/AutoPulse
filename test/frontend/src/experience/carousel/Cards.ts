import { AdditiveBlending, Color, ExtrudeGeometry, FrontSide, Group, HalfFloatType, LinearFilter, Mesh, MeshBasicMaterial, NormalBlending, Raycaster, Shape, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
import type { Camera, Intersection, Object3D, Texture, WebGLRenderer } from 'three';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { Text } from 'troika-three-text';
import { SENSORS } from '../../content/sensors';
import type { Sensor } from '../../content/sensors';
import type { SyntheticSignals } from '../signals/SyntheticSignals';
import { GLSL } from '../shaders';
import type { Shared } from '../Uniforms';
import { CAROUSEL, cardPose } from './CarouselLayout';

export const CARD_W = 2.56;
/** Cards never turn further than this from facing the camera. */
const FACE_LIMIT = (55 * Math.PI) / 180;
export const CARD_H = 1.6;
const CARD_R = 0.16;
const CARD_D = 0.06;
export const FONT_DISPLAY = '/fonts/space-grotesk-latin-500-normal.woff';
export const FONT_MONO = '/fonts/jetbrains-mono-latin-500-normal.woff';
/** Glyphs the title scramble may substitute (all inside the Latin subset of the fonts). */
export const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-#·';

interface Card {
  sensor: Sensor;
  mesh: Mesh;
  mat: ShaderMaterial;
  /** This card's artwork, painted at low resolution by cardArt.frag. */
  art: WebGLRenderTarget;
  color: Color;
  title: Text;
  titleR: Text;
  titleB: Text;
  code: Text;
  line: Text;
  finalTitle: string;
  hover: number;
  tiltX: number;
  tiltY: number;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function makeText(base: MeshBasicMaterial, font: string, size: number, color: string | Color, opts: Partial<Text> = {}) {
  const t = new Text();
  t.material = base;
  t.font = font;
  t.fontSize = size;
  t.color = color;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.textAlign = 'center';
  Object.assign(t, opts);
  return t;
}

/** Title scramble: settled glyphs left of the sweep, random (sometimes doubled) ones to its right. */
function scramble(final: string, p: number) {
  const n = final.length;
  let out = '';
  for (let j = 0; j < n; j++) {
    const ch = final[j];
    if (ch === ' ' || ch === '\n' || j / n < p * 1.2 - 0.2) {
      out += ch;
      continue;
    }
    const r = Math.random();
    if (r < 0.3) out += ch + ch;
    else out += SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
  }
  return out;
}

/** Resolution of each card's painted artwork. */
const ART_W = 512;
const ART_H = 320;

/**
 * The eight glass sensor cards: a thin rounded slab each (one draw call, one shared program,
 * per-card uniforms), plus troika-three-text for the code, the title and the one-line "hears".
 * Each visible card's artwork is painted into its own small texture every frame (renderArt).
 */
export class Cards {
  readonly group = new Group();
  readonly cards: Card[] = [];
  readonly glassTexel = new Vector2(1, 1);
  readonly params = { refraction: 1, tilt: 8 };
  private readonly geometry: ExtrudeGeometry;
  private readonly raycaster = new Raycaster();
  private readonly hits: Intersection<Object3D>[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly ndc = new Vector2();
  private readonly tmp = new Vector3();
  private readonly order = new Int8Array(8);
  private readonly dist = new Float32Array(8);
  private hovered = -1;
  private octaves = 4;
  // front side only: text is never seen from behind (no mirrored titles)
  private readonly textBase = new MeshBasicMaterial({ transparent: true, side: FrontSide, depthWrite: false });
  private readonly glitchBase = new MeshBasicMaterial({ transparent: true, side: FrontSide, depthWrite: false, blending: AdditiveBlending });
  private readonly artMat: ShaderMaterial;
  private glitchIndex = -1;
  private glitchT = 0;
  private glitchTick = 0;

  constructor(glass: Texture, shared: Shared) {
    this.geometry = new ExtrudeGeometry(roundedRect(CARD_W, CARD_H, CARD_R), {
      depth: CARD_D,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
      curveSegments: 10,
    });
    this.geometry.translate(0, 0, -CARD_D / 2);

    const base = new ShaderMaterial({
      vertexShader: GLSL.cardVert,
      fragmentShader: GLSL.cardFrag,
      transparent: true,
      premultipliedAlpha: true,
      blending: NormalBlending,
      depthTest: true,
      depthWrite: false,
      // one face per pixel: the front cap from the front, the back cap from behind
      side: FrontSide,
      uniforms: {
        uTime: shared.uTime,
        uBeat: shared.uBeat,
        uTurb: shared.uTurb,
        uKnock: shared.uKnock,
        uMisfire: shared.uMisfire,
        uValve: shared.uValve,
        uStateW: shared.uStateW,
        tGlass: { value: null },
        uGlassTexel: { value: this.glassTexel },
        uSize: { value: new Vector2(CARD_W, CARD_H) },
        uSensor: { value: 0 },
        uActive: { value: 0 },
        uLod: { value: 0 },
        uHover: { value: 0 },
        uOpacity: { value: 1 },
        uRefract: { value: 1 },
        uColor: { value: new Color() },
        tArt: { value: null },
      },
    });
    this.artMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.cardArt,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexel: { value: new Vector2() },
        uTime: shared.uTime,
        uBeat: shared.uBeat,
        uTurb: shared.uTurb,
        uKnock: shared.uKnock,
        uMisfire: shared.uMisfire,
        uValve: shared.uValve,
        uStateW: shared.uStateW,
        uSensor: { value: 0 },
        uAmp: { value: 0.5 },
        uOct: { value: 4 },
        uAspect: { value: new Vector2(CARD_W / CARD_H, 1) },
        uColor: { value: new Color() },
        uSig: { value: new Vector4() },
      },
    });

    // render-target textures can't go through material.clone(); attach the shared uniform after
    const tGlass = { value: glass };
    for (const sensor of SENSORS) {
      const mat = base.clone();
      // shared uniforms stay shared; per-card ones get their own objects
      for (const k of ['uTime', 'uBeat', 'uTurb', 'uKnock', 'uMisfire', 'uValve', 'uStateW'] as const) mat.uniforms[k] = base.uniforms[k];
      mat.uniforms.tGlass = tGlass;
      mat.uniforms.uGlassTexel = base.uniforms.uGlassTexel;
      mat.uniforms.uSensor.value = sensor.index;
      (mat.uniforms.uColor.value as Color).set(sensor.color);
      const art = new WebGLRenderTarget(ART_W, ART_H, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
      mat.uniforms.tArt = { value: art.texture };

      const mesh = new Mesh(this.geometry, mat);
      mesh.frustumCulled = false;
      mesh.userData.index = sensor.index;

      const finalTitle = sensor.cardTitle.join('\n').toUpperCase();
      const front = CARD_D / 2 + 0.014;
      const titleOpts = { text: finalTitle, letterSpacing: -0.02, lineHeight: 0.95, maxWidth: CARD_W * 0.86 };
      const title = makeText(this.textBase, FONT_DISPLAY, 0.235, '#E9ECEF', titleOpts);
      title.position.set(0, 0.02, front);
      const titleR = makeText(this.glitchBase, FONT_DISPLAY, 0.235, '#FF3355', titleOpts);
      const titleB = makeText(this.glitchBase, FONT_DISPLAY, 0.235, '#33C8FF', titleOpts);
      for (const c of [titleR, titleB]) {
        c.position.set(0, 0.02, front - 0.002);
        c.visible = false;
      }
      const code = makeText(this.textBase, FONT_MONO, 0.058, sensor.color, { text: sensor.code, letterSpacing: 0.14 });
      code.position.set(0, 0.42, front);
      const line = makeText(this.textBase, FONT_DISPLAY, 0.068, '#A9AFC2', { text: sensor.oneLine, maxWidth: CARD_W * 0.7, lineHeight: 1.25 });
      line.position.set(0, -0.48, front);
      mesh.add(titleR, titleB, title, code, line);

      this.group.add(mesh);
      this.meshes.push(mesh);
      this.cards.push({ sensor, mesh, mat, art, color: new Color(sensor.color), title, titleR, titleB, code, line, finalTitle, hover: 0, tiltX: 0, tiltY: 0 });
    }
    base.dispose();
  }

  /** Resolves once every text has been laid out (glyph atlas warm). */
  sync(): Promise<void> {
    const all: Text[] = [];
    for (const c of this.cards) all.push(c.title, c.titleR, c.titleB, c.code, c.line);
    return Promise.all(all.map((t) => new Promise<void>((resolve) => t.sync(() => resolve())))).then(() => undefined);
  }

  setOctaves(n: number) {
    this.octaves = n;
  }

  /** Index of the card under the pointer (ndc -1..1), or -1. */
  pick(nx: number, ny: number, camera: Camera): number {
    if (!this.group.visible) return -1;
    this.ndc.set(nx, ny);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.meshes, false, this.hits);
    for (const h of this.hits) {
      const i = h.object.userData.index as number;
      if (this.cards[i].mat.uniforms.uOpacity.value > 0.25) return i;
    }
    return -1;
  }

  setHovered(i: number) {
    this.hovered = i;
  }

  /** ~400 ms title reveal on the newly active card: glyph scramble settling left to right, plus
   *  red and blue copies that collapse onto the title (chromatic split). */
  glitch(i: number) {
    this.endGlitch();
    this.glitchIndex = i;
    this.glitchT = 0;
    this.glitchTick = 1;
    const c = this.cards[i];
    c.titleR.visible = true;
    c.titleB.visible = true;
  }

  private endGlitch() {
    if (this.glitchIndex < 0) return;
    const c = this.cards[this.glitchIndex];
    c.title.text = c.titleR.text = c.titleB.text = c.finalTitle;
    c.titleR.visible = false;
    c.titleB.visible = false;
    c.titleR.position.x = 0;
    c.titleB.position.x = 0;
    this.glitchIndex = -1;
  }

  private updateGlitch(dt: number) {
    if (this.glitchIndex < 0) return;
    const c = this.cards[this.glitchIndex];
    this.glitchT += dt;
    this.glitchTick += dt;
    const p = Math.min(1, this.glitchT / 0.42);
    if (p >= 1) {
      this.endGlitch();
      return;
    }
    if (this.glitchTick > 0.035) {
      this.glitchTick = 0;
      const s = scramble(c.finalTitle, p);
      c.title.text = c.titleR.text = c.titleB.text = s;
    }
    const off = (1 - p) * (1 - p) * 0.07;
    c.titleR.position.x = -off;
    c.titleB.position.x = off;
    c.titleR.fillOpacity = c.titleB.fillOpacity = (1 - p) * 0.85;
  }

  /**
   * Place every card for carousel position c and style it by its distance from the active one.
   * `px, py` (-1..1) is the pointer, used for the hover tilt.
   */
  /** Paint the artwork of every visible card (all of them when `all`, for pre-warm). */
  renderArt(renderer: WebGLRenderer, quad: FullscreenQuad, signals: SyntheticSignals, rpmNorm: number, all = false) {
    const u = this.artMat.uniforms;
    (u.uSig.value as Vector4).set(signals.throttle, signals.trimShort / 10, rpmNorm, (signals.coolant - 80) / 12);
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      if (!all && (!card.mesh.visible || card.mat.uniforms.uOpacity.value < 0.01)) continue;
      u.uSensor.value = i;
      u.uAmp.value = signals.amp[i];
      u.uOct.value = card.mat.uniforms.uLod.value > 0.5 ? Math.max(2, this.octaves - 1) : this.octaves;
      (u.uColor.value as Color).copy(card.color);
      quad.render(renderer, this.artMat, card.art);
    }
  }

  update(dt: number, c: number, wide: boolean, reduced: boolean, camera: Camera, px: number, py: number) {
    this.updateGlitch(dt);
    const k = 1 - Math.exp(-dt * 8);
    const tiltMax = (this.params.tilt * Math.PI) / 180;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const u = card.mat.uniforms;
      const d = Math.abs(i - c);
      const helixY = cardPose(reduced ? 0 : i, reduced ? 0 : c, wide, card.mesh.position);
      // cards always show their front: keep the helix angle, but never more than 55 degrees away
      // from facing the camera
      const toCam = Math.atan2(camera.position.x - card.mesh.position.x, camera.position.z - card.mesh.position.z);
      let rel = helixY - toCam;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const rotY = toCam + Math.max(-FACE_LIMIT, Math.min(FACE_LIMIT, rel));
      const hoverTarget = this.hovered === i ? 1 : 0;
      card.hover += (hoverTarget - card.hover) * k;
      const tx = card.hover * -py * tiltMax;
      const ty = card.hover * px * tiltMax;
      card.tiltX += (tx - card.tiltX) * k;
      card.tiltY += (ty - card.tiltY) * k;
      card.mesh.rotation.set(card.tiltX, rotY + card.tiltY, 0);
      card.mesh.scale.setScalar(wide ? 1 : CAROUSEL.rowScale);

      const active = d < 1 ? 1 - d : 0;
      const opacity = reduced ? Math.max(0, 1 - d * 1.6) : d < 2.2 ? 1 : Math.max(0, 1 - (d - 2.2) / 0.9);
      card.mesh.visible = opacity > 0.01;
      u.uActive.value = active;
      u.uLod.value = d > 1 ? 1 : d;
      u.uHover.value = card.hover;
      u.uOpacity.value = opacity;
      u.uRefract.value = this.params.refraction;

      // text: full on the active card, dimmer on neighbours; dimmer still when seen from behind
      this.tmp.copy(camera.position).sub(card.mesh.position);
      const facing = Math.sin(rotY) * this.tmp.x + Math.cos(rotY) * this.tmp.z > 0 ? 1 : 0.35;
      const textA = opacity * (0.45 + 0.55 * active) * facing;
      card.title.fillOpacity = textA;
      card.code.fillOpacity = textA;
      card.line.fillOpacity = textA * active;
      this.dist[i] = camera.position.distanceToSquared(card.mesh.position);
    }
    // draw far cards first; each card's texts right after it
    for (let i = 0; i < 8; i++) this.order[i] = i;
    for (let i = 1; i < 8; i++) {
      const v = this.order[i];
      let j = i - 1;
      while (j >= 0 && this.dist[this.order[j]] < this.dist[v]) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = v;
    }
    for (let r = 0; r < 8; r++) {
      const card = this.cards[this.order[r]];
      const base = r * 6;
      card.mesh.renderOrder = base;
      card.titleR.renderOrder = base + 1;
      card.titleB.renderOrder = base + 2;
      card.title.renderOrder = base + 3;
      card.code.renderOrder = base + 4;
      card.line.renderOrder = base + 5;
    }
  }

  get materials() {
    return this.cards.map((c) => c.mat);
  }

  get artMaterial() {
    return this.artMat;
  }

  /** Show everything that is normally hidden (glitch copies), so pre-warm compiles it too. */
  setWarm(on: boolean) {
    for (const c of this.cards) {
      c.titleR.visible = on;
      c.titleB.visible = on;
      c.mesh.visible = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.textBase.dispose();
    this.glitchBase.dispose();
    this.artMat.dispose();
    for (const c of this.cards) {
      c.mat.dispose();
      c.art.dispose();
      c.title.dispose();
      c.titleR.dispose();
      c.titleB.dispose();
      c.code.dispose();
      c.line.dispose();
    }
  }
}
