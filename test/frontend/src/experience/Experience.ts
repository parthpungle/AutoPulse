import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { HalfFloatType, MathUtils, Mesh, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Material } from 'three';
import { Anchors } from './Anchors';
import { Composite } from './Composite';
import { Layout } from './Layout';
import { PerfMonitor } from './PerfMonitor';
import { Pointer } from './Pointer';
import { detectQuality, tierSettings } from './Quality';
import type { QualityResult, Tier, TierSettings } from './Quality';
import { ScrollState } from './ScrollState';
import { Sizes } from './Sizes';
import { applyState } from './States';
import type { EngineState } from './States';
import { createShared } from './Uniforms';
import type { Shared } from './Uniforms';
import { FullscreenQuad } from './gl/FullscreenQuad';
import { canRenderHalfFloat } from './gl/caps';
import { readPalette } from './palette';
import type { Palette } from './palette';
import { BackdropScene } from './scenes/BackdropScene';
import { CAMERA_BASE_Z, CAMERA_FOV, ParticleScene } from './scenes/ParticleScene';
import { FluidSim } from './sim/FluidSim';
import { ParticleSim } from './sim/ParticleSim';
import { generateTargets } from './sim/Targets';

gsap.registerPlugin(ScrollTrigger);

export interface ExperienceOptions {
  sections: HTMLElement[];
  reducedMotion: boolean;
  /** 0..1 as targets build, shaders compile and warm frames run. */
  onProgress?: (p: number) => void;
  /** Nearest section index, called when it changes. */
  onSection?: (index: number) => void;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * The WebGL engine: one renderer and one frame loop for the whole page. Framework-agnostic;
 * the React <Experience/> component creates it on mount and disposes it on unmount.
 *
 * Frame: Lenis -> scroll state -> pointer -> camera -> fluid -> particle sim -> layers -> composite.
 */
export class Experience {
  private static current: Experience | null = null;

  static create(container: HTMLElement, options: ExperienceOptions) {
    Experience.current?.dispose();
    Experience.current = new Experience(container, options);
    return Experience.current;
  }

  static get instance() {
    return Experience.current;
  }

  readonly canvas: HTMLCanvasElement;
  readonly ready: Promise<void>;
  readonly layout = new Layout();
  readonly anchors = new Anchors();
  readonly perf = new PerfMonitor();
  readonly params = { alpha: 0.62 };
  readonly scroll: ScrollState;
  readonly pointer = new Pointer();

  renderer!: WebGLRenderer;
  sizes!: Sizes;
  quality!: QualityResult;
  settings!: TierSettings;
  palette!: Palette;
  shared!: Shared;
  fluid!: FluidSim;
  sim!: ParticleSim;
  backdrop!: BackdropScene;
  particles!: ParticleScene;
  composite!: Composite;
  state: EngineState = 'baseline';
  reduced: boolean;

  private quad!: FullscreenQuad;
  private readonly options: ExperienceOptions;
  private readonly intro = { value: 0 };
  private readonly motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  private running = false;
  private failed = false;
  private hidden = document.hidden;
  private disposed = false;
  private section = -1;
  private fluidResizeTimer = 0;

  private constructor(container: HTMLElement, options: ExperienceOptions) {
    this.options = options;
    this.reduced = options.reducedMotion;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tt-gl';
    container.appendChild(this.canvas);
    this.scroll = new ScrollState(options.sections, this.reduced);
    this.pointer.ghost = !this.reduced;
    this.ready = this.init();
  }

  private progress(p: number) {
    this.options.onProgress?.(p);
  }

  private async init() {
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) {
      this.fail();
      throw e;
    }
    const r = this.renderer;
    if (!r.capabilities.isWebGL2 || !canRenderHalfFloat(r)) {
      this.fail();
      throw new Error('WebGL2 with float render targets is required');
    }
    r.setClearColor(0x000000, 0);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.palette = readPalette();
    this.shared = createShared(this.palette);
    r.setClearColor(this.palette.bg, 1);
    r.clear();
    r.setClearColor(0x000000, 0);

    this.quality = await detectQuality(r);
    this.settings = tierSettings(this.quality.tier);
    this.progress(0.1);
    if (this.disposed) return;

    const set = await generateTargets(this.settings.side, (done, total) => this.progress(0.1 + 0.35 * (done / total)));
    if (this.disposed) {
      for (const t of set.targets) t.dispose();
      return;
    }

    this.sizes = new Sizes(this.canvas, this.settings.dprCap, this.onResize);
    const aspect = this.sizes.width / this.sizes.height;
    this.quad = new FullscreenQuad();
    this.fluid = new FluidSim(r, this.quad, this.settings.fluidRes, aspect);
    this.fluid.params.iterations = this.settings.jacobi;
    this.sim = new ParticleSim(r, this.quad, this.settings.side, set, this.shared, this.layout);
    this.backdrop = new BackdropScene(this.quad.geometry, this.shared, this.palette);
    this.particles = new ParticleScene(this.settings.side, this.settings.count, set.rand, this.shared, this.palette);
    this.composite = new Composite(r, this.particles.camera, this.backdrop.rt.texture, this.particles.rt.texture, this.shared, this.palette);
    this.composite.setBloom(this.settings.bloom);
    this.composite.setFadeReveal(this.reduced);
    this.onResize();
    this.applyFluidSize();

    for (const t of set.targets) r.initTexture(t);
    r.initTexture(set.spawn);
    r.initTexture(set.randTexture);
    this.progress(0.5);

    await this.precompile();
    this.progress(0.8);
    if (this.disposed) return;

    // warm frames behind the preloader: allocates every target and compiles the post chain
    for (let i = 0; i < 8; i++) {
      this.frame(1 / 60);
      this.progress(0.8 + 0.2 * ((i + 1) / 8));
      await nextFrame();
      if (this.disposed) return;
    }
    this.sim.reset();
    this.shared.uTime.value = 0;

    this.motionQuery.addEventListener('change', this.onMotion);
    document.addEventListener('visibilitychange', this.onVisibility);
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(this.tick);
    this.running = true;
    this.perf.hold(1.5);
    this.exposePerf();
  }

  /** Compiles every program for the render-target state it is used in, then draws each once. */
  private async precompile() {
    const r = this.renderer;
    const scratch = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false });
    const mats: Material[] = [...this.fluid.materials, ...this.sim.materials, ...this.backdrop.materials, ...this.composite.materials];
    const tmp = new Scene();
    for (const m of mats) {
      const mesh = new Mesh(this.quad.geometry, m);
      mesh.frustumCulled = false;
      tmp.add(mesh);
    }
    r.setRenderTarget(scratch);
    await r.compileAsync(tmp, this.quad.camera);
    r.setRenderTarget(scratch);
    await r.compileAsync(this.particles.scene, this.particles.camera);
    for (const m of mats) this.quad.render(r, m, scratch);
    r.setRenderTarget(scratch);
    r.render(this.particles.scene, this.particles.camera);
    r.setRenderTarget(null);
    tmp.clear();
    scratch.dispose();
    this.sim.reset();
  }

  /** No usable WebGL: the page still works as a plain document, with native scrolling. */
  private fail() {
    this.failed = true;
    document.documentElement.classList.add('no-webgl');
    this.canvas.remove();
    this.scroll.dispose();
  }

  /** Intro: the wipe uncovers the canvas while the particle seed bursts into the hero ribbon. */
  reveal() {
    const tl = gsap.timeline();
    if (this.failed || !this.composite) return tl;
    this.scroll.lenis.start();
    tl.to(this.composite.reveal, { value: 1, duration: this.reduced ? 0.6 : 1.0, ease: this.reduced ? 'power1.out' : 'expo.inOut' }, 0);
    tl.to(this.intro, { value: 1, duration: 1.8, ease: 'power2.out' }, this.reduced ? 0 : 0.2);
    return tl;
  }

  setState(state: EngineState) {
    this.state = state;
    applyState(this.shared, this.palette, state);
  }

  anchorSignal(el: HTMLElement, channel: number) {
    this.anchors.add(el, 1, (out) => this.layout.signalAnchor(channel, out));
  }

  anchorCluster(el: HTMLElement, index: number) {
    this.anchors.add(el, 3, (out) => this.layout.clusterAnchor(index, out));
  }

  scrollTo(target: string | HTMLElement) {
    if (this.failed) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      el?.scrollIntoView({ behavior: this.reduced ? 'auto' : 'smooth' });
      return;
    }
    this.scroll.lenis.scrollTo(target, { duration: this.reduced ? 0 : 1.6 });
  }

  private tick = (time: number, deltaMs: number) => {
    if (this.disposed) return;
    this.scroll.lenis.raf(time * 1000);
    if (this.hidden) return;
    const dt = Math.min(Math.max(deltaMs / 1000, 1 / 240), 1 / 30);
    this.perf.sample(deltaMs / 1000);
    if (this.perf.shouldDrop(deltaMs / 1000) && this.settings.tier > 0) this.dropTier();
    this.frame(dt);
  };

  private frame(dt: number) {
    const s = this.shared;
    s.uTime.value += dt * (this.reduced ? 0.35 : 1);
    const time = s.uTime.value;
    const sc = this.scroll;
    const p = this.pointer;
    sc.update();
    p.update(dt, time);

    const sf = sc.sectionFloat;
    this.particles.updateCamera(sf, this.reduced ? 0 : p.nx, this.reduced ? 0 : p.ny);
    const cam = this.particles.camera;
    this.sim.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    if (!this.reduced) {
      if (p.splatStrength > 0) this.fluid.splat(p.splatX, p.splatY, p.splatDX, p.splatDY, p.splatStrength);
      this.fluid.step(dt);
    }

    this.sim.setSections(sc.secA, sc.secB, sc.morph);
    this.sim.uniforms.uIntro.value = this.intro.value;
    this.sim.uniforms.uReduced.value = this.reduced ? 1 : 0;
    this.sim.step(dt, this.fluid.texture);

    const pu = this.particles.material.uniforms;
    this.particles.setTextures(this.sim.positions, this.sim.velocities);
    pu.uFade.value = this.reduced ? Math.abs(2 * sc.morph - 1) : 1;
    pu.uAlpha.value = this.params.alpha * this.particles.densityBoost;

    const r = this.renderer;
    this.backdrop.update(sf);
    this.backdrop.render(r);
    this.particles.render(r);
    this.composite.update(this.reduced ? 0 : p.speed, this.reduced ? 0 : Math.sin(Math.PI * sc.morph), s.uValve.value);
    this.composite.render(dt);

    this.anchors.update(cam, this.sizes.width, this.sizes.height, sf);
    const idx = Math.round(sf);
    if (idx !== this.section) {
      this.section = idx;
      this.options.onSection?.(idx);
    }
  }

  private onResize = () => {
    if (!this.composite) return;
    const { width, height, dpr } = this.sizes;
    const r = this.renderer;
    r.setPixelRatio(dpr);
    r.setSize(width, height, false);
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    this.backdrop.setSize(bw, bh);
    this.particles.setSize(bw, bh);
    this.composite.setSize(width, height);
    const aspect = width / height;
    const vh = 2 * CAMERA_BASE_Z * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);
    this.layout.update(vh * aspect, vh);
    this.pointer.setAspect(aspect);
    this.anchors.refresh();
    this.scroll.measure();
    this.perf.hold(1);
    window.clearTimeout(this.fluidResizeTimer);
    this.fluidResizeTimer = window.setTimeout(() => this.applyFluidSize(), 150);
  };

  private applyFluidSize() {
    if (this.disposed) return;
    this.fluid.resize(this.settings.fluidRes, this.sizes.width / this.sizes.height);
    this.sim.fluidScale.set(this.layout.view.x / this.fluid.width, this.layout.view.y / this.fluid.height);
  }

  /** One step down: fewer particles drawn, lower DPR cap, smaller fluid grid, bloom off at tier 0. */
  setTier(tier: Tier) {
    const next = tierSettings(tier);
    this.settings = { ...next, side: this.settings.side };
    this.particles.setDrawCount(next.count);
    this.fluid.params.iterations = next.jacobi;
    this.composite.setBloom(next.bloom);
    this.sizes.setMaxDpr(next.dprCap);
    this.applyFluidSize();
    this.perf.hold(1.5);
  }

  private dropTier() {
    this.setTier((this.settings.tier - 1) as Tier);
  }

  private onMotion = () => {
    this.reduced = this.motionQuery.matches;
    this.scroll.setReduced(this.reduced);
    this.pointer.ghost = !this.reduced;
    this.composite.setFadeReveal(this.reduced);
    if (this.reduced) this.fluid.clear();
  };

  private onVisibility = () => {
    this.hidden = document.hidden;
    if (!this.hidden) this.perf.hold(1);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.running = false;
    gsap.ticker.remove(this.tick);
    document.documentElement.classList.add('no-webgl');
  };

  private exposePerf() {
    const q = new URLSearchParams(location.search);
    if (!q.has('perf') && !q.has('debug')) return;
    const heap: number[] = [];
    const mem = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    (window as unknown as Record<string, unknown>).__tt = {
      engine: this,
      perf: () => ({ ...this.perf.stats(), tier: this.settings.tier, particles: this.particles.count, gpu: this.quality.gpu, source: this.quality.source, dpr: this.sizes.dpr, heap: heap.slice() }),
      resetPerf: () => {
        this.perf.reset();
        heap.length = 0;
      },
      sampleHeap: () => heap.push(mem()),
    };
  }

  /** For the debug panel and the README numbers. */
  get world() {
    return { view: this.layout.view.clone(), camera: this.particles.camera.position.clone() as Vector3 };
  }

  get isRunning() {
    return this.running;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    gsap.ticker.remove(this.tick);

    window.clearTimeout(this.fluidResizeTimer);
    this.motionQuery.removeEventListener('change', this.onMotion);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.scroll.dispose();
    this.pointer.dispose();
    this.sizes?.dispose();
    this.anchors.clear();
    this.fluid?.dispose();
    this.sim?.dispose();
    this.backdrop?.dispose();
    this.particles?.dispose();
    this.composite?.dispose();
    this.quad?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.canvas.remove();
    if (Experience.current === this) Experience.current = null;
    delete (window as unknown as Record<string, unknown>).__tt;
  }
}
