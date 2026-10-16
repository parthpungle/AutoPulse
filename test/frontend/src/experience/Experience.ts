import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Color, DataTexture, HalfFloatType, MathUtils, Mesh, RGBAFormat, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { preloadFont } from 'troika-three-text';
import { SENSORS, SENSOR_COUNT } from '../content/sensors';
import { Cards, FONT_DISPLAY, FONT_MONO, SCRAMBLE } from './carousel/Cards';
import { StepSection } from './scroll/StepSection';
import { Flows } from './sim/Flows';
import { FlowPaths } from './sim/Paths';
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
import { themePalette } from './theme';
import type { Palette } from './theme';
import { BackdropScene } from './scenes/BackdropScene';
import { CAMERA_BASE_Z, CAMERA_FOV, MainScene } from './scenes/MainScene';
import { ClusterRing } from './scenes/ClusterRing';
import { SEAM, Seam } from './seam/Seam';
import { SensorRig } from './sensors/SensorRig';
import { SyntheticSignals } from './signals/SyntheticSignals';
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
  /** Active sensor card in the Sensor Array, called when it changes. */
  onCard?: (index: number) => void;
  /** The active card was clicked (open its detail panel). */
  onOpenCard?: (index: number) => void;
}

/** Ink octaves for the card artwork per quality tier. */
const CARD_OCTAVES = [3, 3, 4, 5];
const SENSOR_COLORS = SENSORS.map((s) => new Color(s.color));

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
  readonly signals = new SyntheticSignals();

  renderer!: WebGLRenderer;
  sizes!: Sizes;
  quality!: QualityResult;
  settings!: TierSettings;
  palette!: Palette;
  shared!: Shared;
  fluid!: FluidSim;
  sim!: ParticleSim;
  backdrop!: BackdropScene;
  main!: MainScene;
  composite!: Composite;
  rig!: SensorRig;
  ring!: ClusterRing;
  /** The cut between sections (seam position and torn strips). */
  readonly seam = new Seam();
  /** ?cut=0..1 (or ?cut=sweep): a fixed seam over a flat debug colour, with a DOM overlay clipped
   *  by the same polygon, to check that GL and DOM cut in the same place. */
  private cutTest: number | 'sweep' | null = null;
  private cutTex: DataTexture | null = null;
  private cutEl: HTMLElement | null = null;
  /** The selected Recognition cluster (-1: none), and the last one (the ring fades out there). */
  selectedCluster = -1;
  private ringCluster = -1;
  /** Draw calls in the last frame: everything, and the 3-D scene alone. */
  calls = 0;
  sceneCalls = 0;
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
  readonly carousel: StepSection;
  readonly paths = new FlowPaths();
  readonly flows = new Flows();
  private readonly tipPos = new Vector3();
  cards!: Cards;
  private activeCard = -1;
  private detail = false;
  private hoverDirty = false;
  private hoverCard = -1;
  /** The HTML detail panel: the expanded card follows its box. */
  private detailEl: HTMLElement | null = null;
  /** The "details" hint pinned under the active card, and its last written position. */
  private hintEl: HTMLElement | null = null;
  private hintOn = false;
  private hintX = NaN;
  private hintY = NaN;
  private settleT = 0;
  private readonly hintPos = new Vector3();

  private constructor(container: HTMLElement, options: ExperienceOptions) {
    this.options = options;
    this.reduced = options.reducedMotion;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tt-gl';
    container.appendChild(this.canvas);
    this.scroll = new ScrollState(options.sections, this.reduced);
    this.carousel = new StepSection(this.scroll, 1, SENSOR_COUNT, this.reduced);
    this.carousel.logging = new URLSearchParams(location.search).has('debug');
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

    this.palette = themePalette();
    this.shared = createShared(this.palette);
    r.setClearColor(this.palette.bg0, 1);
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
    this.main = new MainScene(this.settings.side, this.settings.count, set.rand, this.shared, this.palette);
    this.rig = new SensorRig(r, this.palette, this.settings.tier >= 2, this.shared);
    this.rig.attach(this.main.scene);
    this.ring = new ClusterRing(this.shared.uTime);
    this.main.scene.add(this.ring.mesh);
    // flows: the sim reads the paths and phases; the draw pass colours by pool (sharing the morph
    // uniforms and the active sensor)
    const su = this.sim.uniforms;
    const pu = this.main.material.uniforms;
    su.tPaths.value = this.paths.texture;
    su.uRigOffset.value = this.paths.offset;
    su.uFlowPhase.value = this.flows.phase;
    pu.uActiveSensor = su.uActiveSensor;
    pu.uActiveTip.value = this.tipPos;
    pu.uSecA = su.uSecA;
    pu.uSecB = su.uSecB;
    pu.uMorph = su.uMorph;
    pu.tStreams.value = set.targets[1];
    pu.tClusters.value = set.targets[3];
    this.cards = new Cards(this.main.glassRT.texture, this.shared);
    this.cards.setOctaves(CARD_OCTAVES[this.settings.tier]);
    this.main.cardScene.add(this.cards.group);
    this.main.setBackdrop(this.backdrop.rt.texture);
    r.info.autoReset = false;
    this.composite = new Composite(r, this.main.camera, this.backdrop.rt.texture, this.main.rt.texture, this.shared, this.palette);
    this.composite.setBloom(this.settings.bloom);
    this.setupCutTest();
    this.composite.setFadeReveal(this.reduced);
    this.onResize();
    this.applyFluidSize();

    for (const t of set.targets) r.initTexture(t);
    r.initTexture(set.spawn);
    r.initTexture(set.randTexture);
    this.paths.update(this.rig);
    r.initTexture(this.paths.texture);
    // card text: lay out every string and warm the glyph atlas with the scramble set
    await Promise.all([
      this.cards.sync(),
      new Promise<void>((resolve) => preloadFont({ font: FONT_DISPLAY, characters: SCRAMBLE }, resolve)),
      new Promise<void>((resolve) => preloadFont({ font: FONT_MONO, characters: SCRAMBLE }, resolve)),
    ]);
    if (this.disposed) return;
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
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('click', this.onClick);
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
    const mats: Material[] = [...this.fluid.materials, ...this.sim.materials, ...this.backdrop.materials, ...this.composite.materials, this.main.materials[1]];
    const tmp = new Scene();
    for (const m of mats) {
      const mesh = new Mesh(this.quad.geometry, m);
      mesh.frustumCulled = false;
      tmp.add(mesh);
    }
    r.setRenderTarget(scratch);
    await r.compileAsync(tmp, this.quad.camera);
    r.setRenderTarget(scratch);
    await r.compileAsync(this.main.scene, this.main.camera);
    // both material tiers for the rig, so a quality drop only swaps materials
    const high = this.rig.isHighTier;
    this.rig.setHighTier(!high);
    r.setRenderTarget(scratch);
    await r.compileAsync(this.main.scene, this.main.camera);
    r.render(this.main.scene, this.main.camera);
    this.rig.setHighTier(high);
    // the contact shadow's silhouette and blur programs (used on tier >= 2)
    if (high) this.rig.shadow.renderSilhouette(r, this.quad, this.main.scene, true);
    // the glass cards, their text and the glitch copies; allocate the glass target too
    this.cards.group.visible = true;
    this.cards.setWarm(true);
    this.cards.renderArt(r, this.quad, this.signals, 0, true);
    r.setRenderTarget(scratch);
    await r.compileAsync(this.main.cardScene, this.main.camera);
    r.render(this.main.cardScene, this.main.camera);
    this.cards.setWarm(false);
    this.main.cardsVisible = true;
    this.main.renderLayers(r, this.quad);
    this.main.cardsVisible = false;
    for (const m of mats) this.quad.render(r, m, scratch);
    r.setRenderTarget(scratch);
    r.render(this.main.scene, this.main.camera);
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

  /**
   * Recognition selection: cluster i lights up (100%, +15% size, a ring) and the others dim; -1 is
   * the Default look (all four at 70%). Separate from setState, which drives the rest of the page.
   */
  setClusterSelection(i: number) {
    this.selectedCluster = i;
    if (i >= 0) this.ringCluster = i;
    const sel = this.shared.uClusterSel.value;
    const to = { x: i === 0 ? 1 : 0, y: i === 1 ? 1 : 0, z: i === 2 ? 1 : 0, w: i === 3 ? 1 : 0 };
    const d = this.reduced ? 0 : 0.4;
    gsap.to(sel, { ...to, duration: d, ease: 'power2.out', overwrite: true });
    gsap.to(this.shared.uAnySel, { value: i >= 0 ? 1 : 0, duration: d, ease: 'power2.out', overwrite: true });
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
    const r = this.renderer;
    r.info.reset();
    s.uTime.value += dt * (this.reduced ? 0.35 : 1);
    const time = s.uTime.value;
    const sc = this.scroll;
    const p = this.pointer;
    sc.update();
    p.update(dt, time);

    const sf = sc.sectionFloat;
    this.signals.update(dt, s, this.reduced);
    this.main.wide = this.layout.wide === 1;
    this.carousel.update();
    this.main.carousel = this.reduced ? 0 : this.carousel.value;
    this.main.updateCamera(sf, this.reduced ? 0 : p.nx, this.reduced ? 0 : p.ny);
    const cam = this.main.camera;
    // after the camera: the showcase spot is in camera space
    const active = this.carousel.active;
    this.flows.update(dt, this.signals, s, active, this.reduced);
    this.rig.update(dt, this.signals, sf, active, this.main.wide, cam, this.cards.expansion.value, this.reduced, this.reduced ? 0 : p.nx, this.reduced ? 0 : p.ny, this.flows.arrival);
    if (this.rig.group.visible) {
      this.paths.update(this.rig);
      const su = this.sim.uniforms;
      su.uActiveSensor.value = active;
      su.uDataPhase.value = this.flows.dataPhase;
      su.uThrottle.value = this.signals.throttle;
      su.uLambda.value = Math.max(-1, Math.min(1, this.signals.trace(5, this.signals.time) / 0.7));
      su.uDataHalf.value = this.settings.tier <= 1 ? 1 : 0;
      this.rig.tipWorld(active, this.tipPos);
    }
    this.sim.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.updateCards(dt, sf);

    if (!this.reduced) {
      if (p.splatStrength > 0) this.fluid.splat(p.splatX, p.splatY, p.splatDX, p.splatDY, p.splatStrength);
      this.fluid.step(dt);
    }

    this.sim.setSections(sc.secA, sc.secB, sc.morph);
    this.sim.uniforms.uIntro.value = this.intro.value;
    this.sim.uniforms.uReduced.value = this.reduced ? 1 : 0;
    this.sim.step(dt, this.fluid.texture);

    const pu = this.main.material.uniforms;
    this.main.setTextures(this.sim.positions, this.sim.velocities);
    pu.uFade.value = this.reduced ? Math.abs(2 * sc.morph - 1) : 1;
    pu.uAlpha.value = this.params.alpha * this.main.densityBoost;

    const near = 1 - Math.abs(sf - 1);
    this.backdrop.update(sc.progress, near > 0 ? near : 0);
    this.ring.update(dt, this.layout, this.ringCluster, s.uAnySel.value, Math.max(0, 1 - Math.abs(sf - 3) * 2));
    this.backdrop.render(r);
    const before = r.info.render.calls;
    this.rig.renderShadow(r, this.quad, this.main.scene);
    this.main.renderLayers(r, this.quad);
    this.sceneCalls = r.info.render.calls - before;
    this.composite.bloomScale = 1 - 0.8 * this.cards.expansion.value;
    this.updateCut(time);
    this.composite.update(this.reduced ? 0 : p.speed, s.uValve.value);
    this.composite.render(dt);
    this.calls = r.info.render.calls;

    this.anchors.update(cam, this.sizes.width, this.sizes.height, sf);
    const idx = Math.round(sf);
    if (idx !== this.section) {
      this.section = idx;
      this.options.onSection?.(idx);
    }
  }

  private setupCutTest() {
    const q = new URLSearchParams(location.search).get('cut');
    if (q === null) return;
    this.cutTest = q === 'sweep' ? 'sweep' : Math.min(1, Math.max(0, Number(q) || 0.5));
    this.cutTex = new DataTexture(new Uint8Array([0, 110, 70, 255]), 1, 1, RGBAFormat);
    this.cutTex.needsUpdate = true;
    const el = document.createElement('div');
    el.className = 'tt-cuttest';
    el.style.cssText = 'position:fixed;inset:0;z-index:50;pointer-events:none;background:rgba(255,0,180,0.35)';
    document.body.appendChild(el);
    this.cutEl = el;
  }

  /** The cut between sections (until the section worlds exist, only the ?cut test uses it). */
  private updateCut(time: number) {
    const main = this.main.rt.texture;
    if (this.cutTest === null || !this.cutTex || !this.cutEl) {
      this.composite.setLayers(main, main);
      this.composite.setCut(null);
      return;
    }
    const t = this.cutTest === 'sweep' ? 0.5 - 0.5 * Math.cos(time * 0.6) : this.cutTest;
    this.seam.set(t, this.sizes.width, this.sizes.height);
    this.seam.update(time);
    this.composite.setLayers(main, this.cutTex);
    this.composite.setCut(this.seam);
    // the overlay covers the incoming side (below the seam, plus the bleed strips)
    this.cutEl.style.clipPath = this.seam.polygon('below', 0);
  }

  /** Sensor Array: card placement, hover, the active card (glitch reveal, DOM, backdrop tint). */
  private updateCards(dt: number, sf: number) {
    const near = Math.abs(sf - 1) < 1;
    this.main.cardsVisible = near;
    this.cards.group.visible = near;
    if (!near) return;
    const p = this.pointer;
    if (this.hoverDirty) {
      this.hoverDirty = false;
      const hit = this.cards.pick(p.x * 2 - 1, p.y * 2 - 1, this.main.camera);
      if (hit !== this.hoverCard) {
        this.hoverCard = hit;
        this.cards.setHovered(hit);
        window.dispatchEvent(new CustomEvent('tt:hover3d', { detail: hit >= 0 }));
      }
    }
    const c = this.carousel;
    if (this.cards.expansion.value > 0 && this.detailEl) {
      // the expanded card covers the panel's box exactly (read every frame: it can transition)
      const r = this.detailEl.getBoundingClientRect();
      const cr = this.canvas.getBoundingClientRect();
      this.cards.setExpandRect({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }, cr.width, cr.height);
    }
    this.cards.update(dt, c.value, this.layout.wide === 1, this.reduced, this.main.camera, p.nx, p.ny);
    this.updateHint(dt, sf);
    this.cards.renderArt(this.renderer, this.quad, this.signals, (this.signals.rpm - 800) / 2600);
    if (c.active !== this.activeCard) {
      this.activeCard = c.active;
      if (!this.reduced && Math.abs(sf - 1) < 0.5) this.cards.glitch(c.active);
      this.backdrop.tint.copy(SENSOR_COLORS[c.active]);
      this.options.onCard?.(c.active);
    }
  }

  /** "Tap for details": shown on the active card a second after it settles, pinned to its face. */
  private updateHint(dt: number, sf: number) {
    const el = this.hintEl;
    if (!el) return;
    const c = this.carousel;
    const settled = !this.detail && this.cards.expansion.value === 0 && Math.abs(sf - 1) < 0.05 && Math.abs(c.value - c.active) < 0.02;
    this.settleT = settled ? this.settleT + dt : 0;
    const on = this.settleT > 1;
    if (on) {
      const v = this.cards.hintPoint(c.active, this.hintPos).project(this.main.camera);
      const x = Math.round((v.x * 0.5 + 0.5) * this.sizes.width);
      const y = Math.round((0.5 - v.y * 0.5) * this.sizes.height);
      if (x !== this.hintX || y !== this.hintY) {
        this.hintX = x;
        this.hintY = y;
        el.style.setProperty('--hx', `${x}px`);
        el.style.setProperty('--hy', `${y}px`);
      }
    }
    if (on !== this.hintOn) {
      this.hintOn = on;
      el.classList.toggle('is-on', on);
    }
  }

  /** The DOM pieces the engine positions: the detail panel and the card hint. */
  bindCardUI(panel: HTMLElement | null, hint: HTMLElement | null) {
    this.detailEl = panel;
    this.hintEl = hint;
    this.hintOn = false;
    hint?.classList.remove('is-on');
  }

  private onPointerMove = () => {
    this.hoverDirty = true;
  };

  private onClick = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (t?.closest?.('a, button, input, textarea, select, [role="dialog"], [data-ui]')) return;
    if (!this.cards?.group.visible) return;
    const p = this.pointer;
    const hit = this.cards.pick(p.x * 2 - 1, p.y * 2 - 1, this.main.camera);
    if (hit < 0) return;
    if (hit === this.carousel.active) this.options.onOpenCard?.(hit);
    else this.carousel.go(hit);
  };

  /**
   * Detail open/closed: the active card expands in place onto the panel (500 ms), page scroll
   * and card snapping lock, and the showcased sensor moves into the visible area. The panel gets
   * `data-settled` once the card has finished growing, which fades its content in.
   */
  setDetail(open: boolean) {
    if (open === this.detail || this.failed || !this.cards) return;
    this.detail = open;
    this.carousel.enabled = !open;
    if (open) this.scroll.lenis.stop();
    else this.scroll.lenis.start();
    const cards = this.cards;
    const ex = cards.expansion;
    const panel = this.detailEl;
    this.rig.setExploded(open, this.reduced);
    gsap.killTweensOf(ex);
    panel?.removeAttribute('data-settled');
    if (open) {
      cards.setExpanded(this.carousel.active);
      gsap.to(ex, {
        value: 1,
        duration: this.reduced ? 0.25 : 0.5,
        ease: this.reduced ? 'power1.out' : 'power3.out',
        onComplete: () => panel?.setAttribute('data-settled', ''),
      });
    } else {
      gsap.to(ex, { value: 0, duration: this.reduced ? 0.2 : 0.45, ease: 'power3.inOut', onComplete: () => cards.setExpanded(-1) });
    }
  }

  /** Bring sensor card i to the front (scrolls the page to it). */
  goToCard(i: number) {
    this.carousel.go(i);
  }

  /** Step the Sensor Array by ±1 (keys); false when that would leave the section. */
  stepCard(dir: number) {
    return this.carousel.step(dir);
  }

  get activeSensor() {
    return this.carousel.active;
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
    this.main.setSize(bw, bh);
    this.composite.setSize(width, height);
    this.cards.glassTexel.set(1 / this.main.glassRT.width, 1 / this.main.glassRT.height);
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
    this.main.setDrawCount(next.count);
    this.fluid.params.iterations = next.jacobi;
    this.composite.setBloom(next.bloom);
    this.rig.setHighTier(tier >= 2);
    this.cards.setOctaves(CARD_OCTAVES[tier]);
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
    this.carousel.setReduced(this.reduced);
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
      perf: () => ({ ...this.perf.stats(), tier: this.settings.tier, particles: this.main.count, calls: this.calls, sceneCalls: this.sceneCalls, gpu: this.quality.gpu, source: this.quality.source, dpr: this.sizes.dpr, heap: heap.slice() }),
      resetPerf: () => {
        this.perf.reset();
        heap.length = 0;
      },
      sampleHeap: () => heap.push(mem()),
      /** ?debug: the Sensor Array's recent gesture decisions, for replaying real traces. */
      gestures: () => this.carousel.log.slice(),
      /** the cut's tunables (seam/Seam.ts) and its current line */
      seamParams: SEAM,
      seamState: () => ({ t: this.seam.t, l: this.seam.l, r: this.seam.r, w: this.seam.w, h: this.seam.h }),
    };
  }

  /** For the debug panel and the README numbers. */
  get world() {
    return { view: this.layout.view.clone(), camera: this.main.camera.position.clone() as Vector3 };
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
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('click', this.onClick);
    this.carousel.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.scroll.dispose();
    this.pointer.dispose();
    this.sizes?.dispose();
    this.anchors.clear();
    this.fluid?.dispose();
    this.sim?.dispose();
    this.backdrop?.dispose();
    this.main?.dispose();
    this.rig?.dispose();
    this.ring?.dispose();
    this.cards?.dispose();
    this.paths.dispose();
    this.composite?.dispose();
    this.cutTex?.dispose();
    this.cutEl?.remove();
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
