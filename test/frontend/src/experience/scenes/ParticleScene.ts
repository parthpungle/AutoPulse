import { AdditiveBlending, BufferAttribute, BufferGeometry, MathUtils, PerspectiveCamera, Points, ShaderMaterial, Vector3 } from 'three';
import type { Texture } from 'three';
import { GLSL } from '../shaders';
import type { Palette } from '../theme';
import type { Shared } from '../Uniforms';
import { FXScene } from './FXScene';

/** Camera framing per section: position and look-at target (dolly and tilt). */
const KEYS = [
  { p: [0, 0, 12], t: [0, 0.3, 0] },
  { p: [0, 0.3, 11.2], t: [0, 0, 0] },
  { p: [0.6, 2.2, 11.4], t: [0.6, -0.5, -1.2] },
  { p: [0, 0, 11.6], t: [0, 0, 0] },
  { p: [0, 0, 11.6], t: [0, 0, 0] },
] as const;

export const CAMERA_FOV = 35;
export const CAMERA_BASE_Z = 12;

/** Additive soft sprites whose positions are fetched from the simulation textures. */
export class ParticleScene extends FXScene {
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  readonly material: ShaderMaterial;
  readonly points: Points;
  private readonly geometry: BufferGeometry;
  private readonly look = new Vector3();
  private readonly pA = new Vector3();
  private readonly pB = new Vector3();
  private readonly tA = new Vector3();
  private readonly tB = new Vector3();
  private drawCount: number;
  private readonly fullCount: number;

  constructor(side: number, count: number, rand: Float32Array, shared: Shared, palette: Palette) {
    super(1);
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
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
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
      },
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

  setSize(bufferWidth: number, bufferHeight: number) {
    super.setSize(bufferWidth, bufferHeight);
    this.camera.aspect = bufferWidth / bufferHeight;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPointScale.value = bufferHeight / (2 * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2));
  }

  /** Camera along the section keyframes, plus pointer parallax. */
  updateCamera(sectionFloat: number, px: number, py: number) {
    const i = Math.min(KEYS.length - 2, Math.floor(sectionFloat));
    const f = Math.min(1, Math.max(0, sectionFloat - i));
    const a = KEYS[i];
    const b = KEYS[i + 1];
    this.pA.set(a.p[0], a.p[1], a.p[2]);
    this.pB.set(b.p[0], b.p[1], b.p[2]);
    this.tA.set(a.t[0], a.t[1], a.t[2]);
    this.tB.set(b.t[0], b.t[1], b.t[2]);
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
    return [this.material];
  }

  dispose() {
    super.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
