import { BufferAttribute, BufferGeometry, Color, CustomBlending, HalfFloatType, LinearFilter, MathUtils, OneFactor, PerspectiveCamera, Points, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, ZeroFactor } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { SENSORS } from '../../content/sensors';
import { orbitPose } from '../carousel/CarouselLayout';
import type { Ranges } from '../sim/Ranges';
import { CLUSTERS } from '../sim/Targets';
import { GLSL } from '../shaders';
import type { Palette } from '../theme';
import type { Shared } from '../Uniforms';

/** Camera framing per section: position and look-at target. Section 1 orbits the crankshaft instead. */
const KEYS = [
  { p: [0, 0, 12], t: [0, 0.3, 0] },
  { p: [0, 0, 12], t: [0, 0, 0] }, // unused: Sensor Array uses orbitPose()
  { p: [0.6, 2.2, 11.4], t: [0.6, -0.5, -1.2] },
  { p: [0, 0, 11.6], t: [0, 0, 0] },
  { p: [0, 0, 11.6], t: [0, 0, 0] },
] as const;

export const CAMERA_FOV = 35;
export const CAMERA_BASE_Z = 12;

/** One section's 3-D world: its own scene, camera and particles. */
export interface World {
  readonly index: number;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Screen-space slide during a cut (CSS px, + = content moves up), applied as a view offset. */
  drift: number;
}

/**
 * The section worlds (hero, Sensor Array, signatures, recognition, CTA). Each has its own scene,
 * camera and particle draw; only the worlds on screen are rendered, each into one of two pooled
 * full-resolution targets with depth (`rtA` holds the current or outgoing world, `rtB` the
 * incoming one during a cut), and the composite cuts between them (seam/Seam.ts).
 * A world renders in up to three steps:
 *  1. its scene: solids (opaque, alpha 1), then the particles with depth test on, so the crank
 *     occludes the flows; particles add light without writing coverage
 *  2. (Sensor Array) glass source: backdrop + this target, copied at half resolution into `glassRT`
 *  3. (Sensor Array) `cardScene`: the glass cards and their text, which sample `glassRT`
 * During a cut each world's camera slides by a view offset (a pure 2-D shift that matches the DOM
 * panels' drift): the outgoing content moves up, the incoming rises into place.
 */
export class MainScene {
  readonly worlds: World[];
  readonly rtA: WebGLRenderTarget;
  readonly rtB: WebGLRenderTarget;
  /** The particle material of section 0; all sections share its uniform objects. */
  readonly material: ShaderMaterial;
  /** One particle draw per section (its range of the simulation texture, see sim/Ranges.ts). */
  readonly points: Points[] = [];
  /** Carousel position 0..7, set by the experience each frame. */
  carousel = 0;
  wide = true;
  /** The glass cards; only drawn while the Sensor Array is on screen. */
  readonly cardScene = new Scene();
  cardsVisible = false;
  readonly glassRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly glassMat: ShaderMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materialsList: ShaderMaterial[] = [];
  private readonly ranges: Ranges;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private cssW = 1;
  private cssH = 1;

  constructor(ranges: Ranges, rand: Float32Array, shared: Shared, palette: Palette) {
    this.ranges = ranges;
    const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true };
    this.rtA = new WebGLRenderTarget(1, 1, opts);
    this.rtB = new WebGLRenderTarget(1, 1, opts);
    this.worlds = KEYS.map((_, index) => {
      const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
      camera.position.set(0, 0, CAMERA_BASE_Z);
      return { index, scene: new Scene(), camera, drift: 0 };
    });
    const side = ranges.side;
    const n = side * side;

    const ref = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      ref[i * 2] = ((i % side) + 0.5) / side;
      ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side;
    }
    const position = new BufferAttribute(new Float32Array(n * 3), 3);
    const aRef = new BufferAttribute(ref, 2);
    const aRand = new BufferAttribute(rand, 4);

    // one set of uniform objects, shared by every section's material (only uSection differs)
    const uniforms = {
      uTime: shared.uTime,
      uBeat: shared.uBeat,
      uTurb: shared.uTurb,
      uKnock: shared.uKnock,
      uMisfire: shared.uMisfire,
      uValve: shared.uValve,
      uStateW: shared.uStateW,
      uAccent: shared.uAccent,
      tPos: { value: null },
      tVel: { value: null },
      uPointScale: { value: 1 },
      uSize: { value: 0.026 },
      uAlpha: { value: 0.62 },
      uFade: { value: 1 },
      uColor: { value: palette.text },
      tParams: { value: null },
      uClusterColors: { value: CLUSTERS.map((c) => new Color(c.color)) },
      uClusterSel: shared.uClusterSel,
      uAnySel: shared.uAnySel,
      uActiveSensor: { value: 0 },
      uActiveTip: { value: null },
      uSensorColors: { value: SENSORS.map((s) => new Color(s.color)) },
    };
    for (const range of ranges.list) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', position);
      geometry.setAttribute('aRef', aRef);
      geometry.setAttribute('aRand', aRand);
      geometry.setDrawRange(range.start, range.count);
      const material = new ShaderMaterial({
        vertexShader: GLSL.pointsVert,
        fragmentShader: GLSL.pointsFrag,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
        uniforms: { ...uniforms, uSection: { value: range.section } },
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.name = `particles-${range.section}`;
      this.geometries.push(geometry);
      this.materialsList.push(material);
      this.points.push(points);
      this.worlds[range.section].scene.add(points);
    }
    this.material = this.materialsList[0];
    this.glassMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.glass,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTexel: { value: new Vector2() }, tBackdrop: { value: null }, tMain: { value: null } },
    });
  }

  /** The Sensor Array's camera (cards, picking, the rig's showcase spot). */
  get camera() {
    return this.worlds[1].camera;
  }

  /** Fewer particles after a quality drop (each section draws a prefix of its range); brightness is
   *  rescaled so the look holds. */
  setDrawCount(count: number) {
    this.ranges.setTierCount(count);
    for (let i = 0; i < this.ranges.list.length; i++) {
      const r = this.ranges.list[i];
      this.geometries[i].setDrawRange(r.start, r.count);
    }
  }

  get densityBoost() {
    return Math.min(1.8, Math.sqrt(this.ranges.baseCount / Math.max(1, this.ranges.list[0].count)));
  }

  /** Particles per section at the current tier. */
  get count() {
    return this.ranges.list[0].count;
  }

  setBackdrop(texture: Texture) {
    this.glassMat.uniforms.tBackdrop.value = texture;
  }

  /** Draw world i into `rt` (cleared first), with the glass cards for the Sensor Array. */
  render(renderer: WebGLRenderer, quad: FullscreenQuad, i: number, rt: WebGLRenderTarget) {
    const w = this.worlds[i];
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, false);
    renderer.render(w.scene, w.camera);
    if (i !== 1 || !this.cardsVisible) return;
    this.glassMat.uniforms.tMain.value = rt.texture;
    quad.render(renderer, this.glassMat, this.glassRT);
    renderer.setRenderTarget(rt);
    renderer.render(this.cardScene, w.camera);
  }

  /** `cssW, cssH`: the canvas in CSS px (view offsets are in those units). */
  setSize(bufferWidth: number, bufferHeight: number, cssW: number, cssH: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    for (const rt of [this.rtA, this.rtB]) rt.setSize(Math.max(1, bufferWidth), Math.max(1, bufferHeight));
    this.glassRT.setSize(Math.max(1, Math.round(bufferWidth / 2)), Math.max(1, Math.round(bufferHeight / 2)));
    for (const w of this.worlds) {
      w.camera.aspect = bufferWidth / bufferHeight;
      w.camera.updateProjectionMatrix();
    }
    this.material.uniforms.uPointScale.value = bufferHeight / (2 * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2));
  }

  private pose(i: number, pos: Vector3, look: Vector3) {
    if (i === 1) {
      orbitPose(this.carousel, this.wide, pos, look);
      return;
    }
    const k = KEYS[i];
    pos.set(k.p[0], k.p[1], k.p[2]);
    look.set(k.t[0], k.t[1], k.t[2]);
  }

  /** Place world i's camera: its section framing (the crank orbit in the Sensor Array), the
   *  pointer parallax, and its drift as a view offset. */
  updateCamera(i: number, px: number, py: number) {
    const w = this.worlds[i];
    const cam = w.camera;
    this.pose(i, this.pos, this.look);
    cam.position.copy(this.pos);
    cam.position.x += px * 0.45;
    cam.position.y += py * 0.28;
    cam.lookAt(this.look);
    if (Math.abs(w.drift) > 0.01) cam.setViewOffset(this.cssW, this.cssH, 0, w.drift, this.cssW, this.cssH);
    else if (cam.view) cam.clearViewOffset();
    cam.updateMatrixWorld();
  }

  setTextures(pos: Texture, vel: Texture) {
    this.material.uniforms.tPos.value = pos;
    this.material.uniforms.tVel.value = vel;
  }

  get materials() {
    return [this.material, this.glassMat];
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.glassRT.dispose();
    this.glassMat.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materialsList) m.dispose();
  }
}
