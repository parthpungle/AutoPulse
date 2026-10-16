import { Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { DoubleFBO } from '../gl/DoubleFBO';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { simTextureType } from '../gl/caps';
import type { Layout } from '../Layout';
import type { Shared } from '../Uniforms';
import { GLSL } from '../shaders';
import type { Range, Ranges } from './Ranges';
import type { TargetSet } from './Targets';

/**
 * GPGPU particles: position and velocity live in float textures and are advanced by ping-pong
 * fragment passes (the GPUComputationRenderer pattern from three.js, MIT). The CPU only swaps
 * targets and sets uniforms. Each section owns a block of rows (Ranges.ts) and is stepped in its
 * own scissored pass, so only the sections on screen cost anything; rows that are not stepped just
 * keep their last state until they come back.
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
  private readonly homeMat: ShaderMaterial;
  private readonly posMat: ShaderMaterial;
  readonly ranges: Ranges;
  private readonly copyMat: ShaderMaterial;
  private readonly renderer: WebGLRenderer;
  private readonly quad: FullscreenQuad;
  private readonly set: TargetSet;

  constructor(renderer: WebGLRenderer, quad: FullscreenQuad, ranges: Ranges, set: TargetSet, shared: Shared, layout: Layout) {
    this.renderer = renderer;
    this.quad = quad;
    this.ranges = ranges;
    const side = (this.side = ranges.side);
    this.set = set;

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
        tParams: { value: set.params },
        tFluid: { value: null },
        uRes: res,
        uSection: { value: 0 },
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
        uRigOffset: { value: new Vector3() },
        uActiveSensor: { value: 0 },
        uFlowPhase: { value: new Float32Array(8) },
        uDataPhase: { value: 0 },
        uThrottle: { value: 0 },
        uLambda: { value: 0 },
        uFlowDensity: { value: 1 },
        uDataHalf: { value: 0 },
      },
    });

    // same uniforms (shared objects), another shader: positions straight onto the home shape
    this.homeMat = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.home,
      depthTest: false,
      depthWrite: false,
      uniforms: this.velMat.uniforms,
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
    return [this.velMat, this.homeMat, this.posMat, this.copyMat];
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

  /** Back to the start: the hero's particles at the spawn seed, every other section on its shape,
   *  all at rest. */
  reset() {
    const r = this.renderer;
    this.scissor(null);
    this.copyMat.uniforms.tSource.value = this.set.spawn;
    this.quad.render(r, this.copyMat, this.pos.read);
    this.quad.render(r, this.copyMat, this.pos.write);
    for (const t of [this.vel.read, this.vel.write]) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    for (const range of this.ranges.list) if (range.section > 0) this.snapHome(range);
    r.setRenderTarget(null);
  }

  /** Put one section's particles on their home shape, at rest. */
  snapHome(range: Range) {
    this.velMat.uniforms.uSection.value = range.section;
    this.scissor(range);
    this.quad.render(this.renderer, this.homeMat, this.pos.read);
    this.quad.render(this.renderer, this.homeMat, this.pos.write);
    this.scissor(null);
  }

  /** Limit the passes to a range's rows (null: the whole texture). */
  private scissor(range: Range | null) {
    for (const t of [this.pos.read, this.pos.write, this.vel.read, this.vel.write]) {
      if (range) t.scissor.set(0, range.rowStart, this.side, this.ranges.activeRows(range));
      t.scissorTest = !!range;
    }
  }

  /** Advance the given sections by dt. `viewProj` (per section) projects for the fluid drag. */
  step(dt: number, fluid: Texture, sections: readonly number[], viewProj?: (section: number) => Matrix4) {
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
    const list = this.ranges.list;
    for (const s of sections) {
      const range = list[s];
      if (!range || range.count <= 0) continue;
      u.uSection.value = s;
      if (viewProj) (u.uViewProj.value as Matrix4).copy(viewProj(s));
      this.scissor(range);
      this.quad.render(this.renderer, this.velMat, this.vel.write);
    }
    this.vel.swap();

    const q = this.posMat.uniforms;
    q.tPos.value = this.pos.read.texture;
    q.tVel.value = this.vel.read.texture;
    q.uDt.value = dt;
    for (const s of sections) {
      const range = list[s];
      if (!range || range.count <= 0) continue;
      this.scissor(range);
      this.quad.render(this.renderer, this.posMat, this.pos.write);
    }
    this.scissor(null);
    this.pos.swap();
  }

  dispose() {
    this.pos.dispose();
    this.vel.dispose();
    this.velMat.dispose();
    this.homeMat.dispose();
    this.posMat.dispose();
    this.copyMat.dispose();
    this.set.params.dispose();
    this.set.spawn.dispose();
    this.set.randTexture.dispose();
  }
}
