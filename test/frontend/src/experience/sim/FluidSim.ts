import { ClampToEdgeWrapping, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three';
import type { IUniform, RenderTargetOptions, Texture, WebGLRenderer } from 'three';
import { DoubleFBO } from '../gl/DoubleFBO';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { GLSL } from '../shaders';

/**
 * Low-resolution stable-fluids solver on the GPU (velocity only, no dye):
 *   advect -> splat pointer -> curl -> vorticity confinement -> divergence -> pressure (Jacobi) -> subtract gradient
 * After Stam, "Stable Fluids" (SIGGRAPH 1999) and Harris, "Fast Fluid Dynamics Simulation on the
 * GPU" (GPU Gems, ch. 38); the pass layout follows Pavel Dobryakov's WebGL-Fluid-Simulation (MIT).
 * Velocity is stored in grid texels per second.
 */
export class FluidSim {
  readonly params = {
    dissipation: 1.1,
    vorticity: 24,
    pressureDecay: 0.8,
    iterations: 8,
    splatRadius: 0.0028,
    splatForce: 5200,
  };

  width = 1;
  height = 1;
  readonly texel = new Vector2();

  private velocity: DoubleFBO;
  private pressure: DoubleFBO;
  private divergence: WebGLRenderTarget;
  private curl: WebGLRenderTarget;
  private readonly mats: Record<'advect' | 'splat' | 'curl' | 'vorticity' | 'divergence' | 'scale' | 'pressure' | 'gradient', ShaderMaterial>;
  private readonly renderer: WebGLRenderer;
  private readonly quad: FullscreenQuad;
  private res: number;
  private aspect: number;

  private pending = false;
  private sx = 0;
  private sy = 0;
  private fx = 0;
  private fy = 0;

  constructor(renderer: WebGLRenderer, quad: FullscreenQuad, res: number, aspect: number) {
    this.renderer = renderer;
    this.quad = quad;
    this.res = res;
    this.aspect = aspect;
    this.computeSize();

    const linear: RenderTargetOptions = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: false };
    const nearest: RenderTargetOptions = { ...linear, minFilter: NearestFilter, magFilter: NearestFilter };
    this.velocity = new DoubleFBO(this.width, this.height, linear);
    this.pressure = new DoubleFBO(this.width, this.height, nearest);
    this.divergence = new WebGLRenderTarget(this.width, this.height, nearest);
    this.curl = new WebGLRenderTarget(this.width, this.height, nearest);

    const texel = { value: this.texel };
    const make = (frag: string, uniforms: Record<string, IUniform>) =>
      new ShaderMaterial({ vertexShader: GLSL.fullscreenVert, fragmentShader: frag, uniforms: { uTexel: texel, ...uniforms }, depthTest: false, depthWrite: false });
    const F = GLSL.fluid;
    this.mats = {
      advect: make(F.advect, { tVelocity: { value: null }, tSource: { value: null }, uDt: { value: 0 }, uDissipation: { value: 0 } }),
      splat: make(F.splat, { tTarget: { value: null }, uPoint: { value: new Vector2() }, uForce: { value: new Vector2() }, uRadius: { value: 0 }, uAspect: { value: 1 } }),
      curl: make(F.curl, { tVelocity: { value: null } }),
      vorticity: make(F.vorticity, { tVelocity: { value: null }, tCurl: { value: null }, uCurl: { value: 0 }, uDt: { value: 0 } }),
      divergence: make(F.divergence, { tVelocity: { value: null } }),
      scale: make(F.scale, { tSource: { value: null }, uScale: { value: 0.8 } }),
      pressure: make(F.pressure, { tPressure: { value: null }, tDivergence: { value: null } }),
      gradient: make(F.gradient, { tPressure: { value: null }, tVelocity: { value: null } }),
    };
    this.clear();
  }

  get texture(): Texture {
    return this.velocity.read.texture;
  }

  get materials(): ShaderMaterial[] {
    return Object.values(this.mats);
  }

  private computeSize() {
    if (this.aspect >= 1) {
      this.height = this.res;
      this.width = Math.round(this.res * this.aspect);
    } else {
      this.width = this.res;
      this.height = Math.round(this.res / this.aspect);
    }
    this.texel.set(1 / this.width, 1 / this.height);
  }

  /** Changes resolution or aspect; the field restarts from rest (cheap at this size). */
  resize(res: number, aspect: number) {
    this.res = res;
    this.aspect = aspect;
    this.computeSize();
    this.velocity.setSize(this.width, this.height);
    this.pressure.setSize(this.width, this.height);
    this.divergence.setSize(this.width, this.height);
    this.curl.setSize(this.width, this.height);
    this.clear();
  }

  clear() {
    const r = this.renderer;
    for (const t of [this.velocity.read, this.velocity.write, this.pressure.read, this.pressure.write, this.divergence, this.curl]) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setRenderTarget(null);
  }

  /** Queue a splat at (x, y) in 0..1 screen space with a pointer delta in the same units. */
  splat(x: number, y: number, dx: number, dy: number, strength: number) {
    this.pending = true;
    this.sx = x;
    this.sy = y;
    this.fx = dx * this.params.splatForce * strength;
    this.fy = dy * this.params.splatForce * strength;
  }

  step(dt: number) {
    const { renderer: r, quad: q, mats: m, params: p } = this;
    const v = this.velocity;

    m.advect.uniforms.tVelocity.value = v.read.texture;
    m.advect.uniforms.tSource.value = v.read.texture;
    m.advect.uniforms.uDt.value = dt;
    m.advect.uniforms.uDissipation.value = p.dissipation;
    q.render(r, m.advect, v.write);
    v.swap();

    if (this.pending) {
      this.pending = false;
      m.splat.uniforms.tTarget.value = v.read.texture;
      (m.splat.uniforms.uPoint.value as Vector2).set(this.sx, this.sy);
      (m.splat.uniforms.uForce.value as Vector2).set(this.fx, this.fy);
      m.splat.uniforms.uRadius.value = p.splatRadius * (this.aspect > 1 ? this.aspect : 1);
      m.splat.uniforms.uAspect.value = this.aspect;
      q.render(r, m.splat, v.write);
      v.swap();
    }

    m.curl.uniforms.tVelocity.value = v.read.texture;
    q.render(r, m.curl, this.curl);

    m.vorticity.uniforms.tVelocity.value = v.read.texture;
    m.vorticity.uniforms.tCurl.value = this.curl.texture;
    m.vorticity.uniforms.uCurl.value = p.vorticity;
    m.vorticity.uniforms.uDt.value = dt;
    q.render(r, m.vorticity, v.write);
    v.swap();

    m.divergence.uniforms.tVelocity.value = v.read.texture;
    q.render(r, m.divergence, this.divergence);

    m.scale.uniforms.tSource.value = this.pressure.read.texture;
    m.scale.uniforms.uScale.value = p.pressureDecay;
    q.render(r, m.scale, this.pressure.write);
    this.pressure.swap();

    m.pressure.uniforms.tDivergence.value = this.divergence.texture;
    for (let i = 0; i < p.iterations; i++) {
      m.pressure.uniforms.tPressure.value = this.pressure.read.texture;
      q.render(r, m.pressure, this.pressure.write);
      this.pressure.swap();
    }

    m.gradient.uniforms.tPressure.value = this.pressure.read.texture;
    m.gradient.uniforms.tVelocity.value = v.read.texture;
    q.render(r, m.gradient, v.write);
    v.swap();
  }

  dispose() {
    this.velocity.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.curl.dispose();
    for (const mat of Object.values(this.mats)) mat.dispose();
  }
}
