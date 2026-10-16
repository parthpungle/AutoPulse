import { BufferAttribute, BufferGeometry, Color, CustomBlending, HalfFloatType, LinearFilter, MathUtils, OneFactor, PerspectiveCamera, Points, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, ZeroFactor } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { SENSORS } from '../../content/sensors';
import { orbitPose } from '../carousel/CarouselLayout';
import { CLUSTERS } from '../sim/Targets';
import { GLSL } from '../shaders';
import type { Palette } from '../theme';
import type { Shared } from '../Uniforms';
import { FXScene } from './FXScene';

/** Camera framing per section: position and look-at target. Section 1 orbits the crankshaft instead. */
const KEYS = [
  { p: [0, 0, 12], t: [0, 0.3, 0] },
  { p: [0, 0, 12], t: [0, 0, 0] }, // unused: Sensor Array uses orbitPose()
  { p: [0, 0, 11.6], t: [0, 0, 0] }, // face-on: the pipeline is a flat diagram
  { p: [0, 0, 11.6], t: [0, 0, 0] },
  { p: [0, 0, 11.6], t: [0, 0, 0] },
] as const;

export const CAMERA_FOV = 35;
export const CAMERA_BASE_Z = 12;

/**
 * The main 3-D layer: one full-resolution render target with a depth buffer, drawn in three steps:
 *  1. `scene`: the Sensor Array rig (opaque, alpha 1), then the particles with depth test on, so
 *     the crankshaft occludes the streams; particles add light without writing coverage
 *  2. glass source: backdrop + this layer copied at half resolution into `glassRT`
 *  3. `cardScene`: the glass cards and their text, which sample `glassRT` (fake refraction)
 * The composite then lays this layer over the backdrop: bd * (1 - a) + rgb.
 */
export class MainScene extends FXScene {
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  readonly material: ShaderMaterial;
  readonly points: Points;
  /** Carousel position 0..7, set by the experience each frame. */
  carousel = 0;
  wide = true;
  /** The glass cards (step 3); only drawn while the Sensor Array is near. */
  readonly cardScene = new Scene();
  cardsVisible = false;
  readonly glassRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly glassMat: ShaderMaterial;
  private readonly geometry: BufferGeometry;
  private readonly look = new Vector3();
  private readonly pA = new Vector3();
  private readonly pB = new Vector3();
  private readonly tA = new Vector3();
  private readonly tB = new Vector3();
  private drawCount: number;
  private readonly fullCount: number;

  constructor(side: number, count: number, rand: Float32Array, shared: Shared, palette: Palette) {
    super(1, true);
    const n = side * side;
    this.fullCount = count;
    this.drawCount = count;

    const ref = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      ref[i * 2] = ((i % side) + 0.5) / side;
      ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side;
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aRef', new BufferAttribute(ref, 2));
    this.geometry.setAttribute('aRand', new BufferAttribute(rand, 4));
    this.geometry.setDrawRange(0, count);

    this.material = new ShaderMaterial({
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
      uniforms: {
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
        tStreams: { value: null },
        tClusters: { value: null },
        tSignals: { value: null },
        uClusterColors: { value: CLUSTERS.map((c) => new Color(c.color)) },
        uClusterSel: shared.uClusterSel,
        uAnySel: shared.uAnySel,
        uActiveSensor: { value: 0 },
        uActiveTip: { value: null },
        uSecA: { value: 0 },
        uSecB: { value: 0 },
        uMorph: { value: 0 },
        uSensorColors: { value: SENSORS.map((s) => new Color(s.color)) },
      },
    });
    this.glassMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.glass,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTexel: { value: new Vector2() }, tBackdrop: { value: null }, tMain: { value: this.rt.texture } },
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.camera.position.set(0, 0, CAMERA_BASE_Z);
  }

  /** Fewer particles after a quality drop; brightness is rescaled so the look holds. */
  setDrawCount(count: number) {
    this.drawCount = Math.min(count, this.fullCount);
    this.geometry.setDrawRange(0, this.drawCount);
  }

  get densityBoost() {
    return Math.min(1.8, Math.sqrt(this.fullCount / this.drawCount));
  }

  get count() {
    return this.drawCount;
  }

  setBackdrop(texture: Texture) {
    this.glassMat.uniforms.tBackdrop.value = texture;
  }

  /** Steps 1-3 (see the class comment). */
  renderLayers(renderer: WebGLRenderer, quad: FullscreenQuad) {
    this.render(renderer);
    if (!this.cardsVisible) return;
    quad.render(renderer, this.glassMat, this.glassRT);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.cardScene, this.camera);
  }

  setSize(bufferWidth: number, bufferHeight: number) {
    super.setSize(bufferWidth, bufferHeight);
    this.glassRT.setSize(Math.max(1, Math.round(bufferWidth / 2)), Math.max(1, Math.round(bufferHeight / 2)));
    this.camera.aspect = bufferWidth / bufferHeight;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPointScale.value = bufferHeight / (2 * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2));
  }

  private pose(i: number, pos: Vector3, look: Vector3) {
    if (i === 1) {
      orbitPose(this.carousel, this.wide, this.camera.aspect, CAMERA_FOV, pos, look);
      return;
    }
    const k = KEYS[i];
    pos.set(k.p[0], k.p[1], k.p[2]);
    look.set(k.t[0], k.t[1], k.t[2]);
  }

  /** Camera along the section keyframes (orbiting the crank in the Sensor Array), plus parallax.
   *  The detail view needs no camera move: the showcase spot and the card are in camera space. */
  updateCamera(sectionFloat: number, px: number, py: number) {
    const i = Math.min(KEYS.length - 2, Math.floor(sectionFloat));
    const f = Math.min(1, Math.max(0, sectionFloat - i));
    this.pose(i, this.pA, this.tA);
    this.pose(i + 1, this.pB, this.tB);
    this.camera.position.lerpVectors(this.pA, this.pB, f);
    this.look.lerpVectors(this.tA, this.tB, f);
    this.camera.position.x += px * 0.45;
    this.camera.position.y += py * 0.28;
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  setTextures(pos: Texture, vel: Texture) {
    this.material.uniforms.tPos.value = pos;
    this.material.uniforms.tVel.value = vel;
  }

  get materials() {
    return [this.material, this.glassMat];
  }

  dispose() {
    super.dispose();
    this.glassRT.dispose();
    this.glassMat.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
