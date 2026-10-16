import { Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector2 } from 'three';
import type { DataTexture, Texture, WebGLRenderer } from 'three';
import { DoubleFBO } from '../gl/DoubleFBO';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { simTextureType } from '../gl/caps';
import type { Layout } from '../Layout';
import type { Shared } from '../Uniforms';
import { GLSL } from '../shaders';
import type { TargetSet } from './Targets';

/**
 * GPGPU particles: position and velocity live in float textures and are advanced by ping-pong
 * fragment passes (the GPUComputationRenderer pattern from three.js, MIT). The CPU only swaps
 * targets and sets uniforms.
 */
export class ParticleSim {
  readonly side: number;
  readonly params = {
    spring: 20,
    damping: 8.5,
    curlAmp: 0.32,
    curlFreq: 0.32,
    curlSpeed: 0.12,
    fluidAmp: 7,
  };

  readonly viewProj = new Matrix4();
  readonly fluidScale = new Vector2();

  private pos: DoubleFBO;
  private vel: DoubleFBO;
  private readonly velMat: ShaderMaterial;
  private readonly posMat: ShaderMaterial;
  private readonly copyMat: ShaderMaterial;
  private readonly renderer: WebGLRenderer;
  private readonly quad: FullscreenQuad;
  private readonly targets: DataTexture[];
  private readonly set: TargetSet;

  constructor(renderer: WebGLRenderer, quad: FullscreenQuad, side: number, set: TargetSet, shared: Shared, layout: Layout) {
    this.renderer = renderer;
    this.quad = quad;
    this.side = side;
    this.set = set;
    this.targets = set.targets;

    const opts = { type: simTextureType(renderer), format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false };
    this.pos = new DoubleFBO(side, side, opts);
    this.vel = new DoubleFBO(side, side, opts);
    const res = { value: new Vector2(side, side) };

    this.velMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.velocity,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...shared,
        uTexel: { value: new Vector2() },
        tPos: { value: null },
        tVel: { value: null },
        tRand: { value: set.randTexture },
        tA: { value: set.targets[0] },
        tB: { value: set.targets[0] },
        tFluid: { value: null },
        uRes: res,
        uSecA: { value: 0 },
        uSecB: { value: 0 },
        uMorph: { value: 0 },
        uDt: { value: 0 },
        uSpring: { value: 0 },
        uDamping: { value: 0 },
        uCurlAmp: { value: 0 },
        uCurlFreq: { value: 0 },
        uCurlSpeed: { value: 0 },
        uFluidAmp: { value: 0 },
        uFluidScale: { value: this.fluidScale },
        uIntro: { value: 0 },
        uReduced: { value: 0 },
        uViewProj: { value: this.viewProj },
        uL0: { value: layout.L0 },
        uL2: { value: layout.L2 },
        uL3: { value: layout.L3 },
        uL4: { value: layout.L4 },
        uClusterC: { value: layout.clusterC },
        tPaths: { value: null },
        uRigOffset: { value: null },
        uActiveSensor: { value: 0 },
        uFlowPhase: { value: null },
        uDataPhase: { value: 0 },
        uThrottle: { value: 0 },
        uLambda: { value: 0 },
        uFlowDensity: { value: 1 },
        uDataHalf: { value: 0 },
      },
    });

    this.posMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.position,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTexel: { value: new Vector2() }, tPos: { value: null }, tVel: { value: null }, uRes: res, uDt: { value: 0 } },
    });

    this.copyMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.copy,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTexel: { value: new Vector2() }, tSource: { value: null } },
    });

    this.reset();
  }

  get materials(): ShaderMaterial[] {
    return [this.velMat, this.posMat, this.copyMat];
  }

  get positions(): Texture {
    return this.pos.read.texture;
  }

  get velocities(): Texture {
    return this.vel.read.texture;
  }

  get uniforms() {
    return this.velMat.uniforms;
  }

  /** Back to the spawn seed, at rest. */
  reset() {
    const r = this.renderer;
    this.copyMat.uniforms.tSource.value = this.set.spawn;
    this.quad.render(r, this.copyMat, this.pos.read);
    this.quad.render(r, this.copyMat, this.pos.write);
    for (const t of [this.vel.read, this.vel.write]) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setRenderTarget(null);
  }

  setSections(a: number, b: number, morph: number) {
    const u = this.velMat.uniforms;
    u.uSecA.value = a;
    u.uSecB.value = b;
    u.uMorph.value = morph;
    u.tA.value = this.targets[a];
    u.tB.value = this.targets[b];
  }

  step(dt: number, fluid: Texture) {
    const u = this.velMat.uniforms;
    const p = this.params;
    u.tPos.value = this.pos.read.texture;
    u.tVel.value = this.vel.read.texture;
    u.tFluid.value = fluid;
    u.uDt.value = dt;
    u.uSpring.value = p.spring;
    u.uDamping.value = p.damping;
    u.uCurlAmp.value = p.curlAmp;
    u.uCurlFreq.value = p.curlFreq;
    u.uCurlSpeed.value = p.curlSpeed;
    u.uFluidAmp.value = p.fluidAmp;
    this.quad.render(this.renderer, this.velMat, this.vel.write);
    this.vel.swap();

    const q = this.posMat.uniforms;
    q.tPos.value = this.pos.read.texture;
    q.tVel.value = this.vel.read.texture;
    q.uDt.value = dt;
    this.quad.render(this.renderer, this.posMat, this.pos.write);
    this.pos.swap();
  }

  dispose() {
    this.pos.dispose();
    this.vel.dispose();
    this.velMat.dispose();
    this.posMat.dispose();
    this.copyMat.dispose();
    for (const t of this.set.targets) t.dispose();
    this.set.spawn.dispose();
    this.set.randTexture.dispose();
  }
}
