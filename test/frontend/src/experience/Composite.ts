import { HalfFloatType, ShaderMaterial, Uniform, Vector2 } from 'three';
import type { Camera, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
import { BlendFunction, BloomEffect, ChromaticAberrationEffect, Effect, EffectComposer, EffectPass, Pass, VignetteEffect } from 'postprocessing';
import { GLSL } from './shaders';
import type { Palette } from './theme';
import type { Shared } from './Uniforms';
import { MAX_STRIPS, SEAM } from './seam/Seam';
import type { Seam } from './seam/Seam';

/** Final pass 1: combines the layer render targets (and draws the intro wipe). */
class LayerPass extends Pass {
  constructor(material: ShaderMaterial) {
    super('LayerPass');
    this.fullscreenMaterial = material;
  }

  render(renderer: WebGLRenderer, _input: WebGLRenderTarget | null, output: WebGLRenderTarget | null) {
    renderer.setRenderTarget(this.renderToScreen ? null : output);
    renderer.render(this.scene, this.camera);
  }
}

/** Film grain applied in a perceptual space, so it never lifts the blacks. Animated by time. */
class GrainEffect extends Effect {
  constructor() {
    super(
      'GrainEffect',
      /* glsl */ `
      uniform float uAmount;
      float grainHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = sqrt(max(inputColor.rgb, 0.0));
        float n = grainHash(floor(uv * resolution) + fract(time * 7.13) * 917.0) - 0.5;
        c = max(c + n * uAmount, 0.0);
        outputColor = vec4(c * c, inputColor.a);
      }`,
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uAmount', new Uniform(0.045)]]) },
    );
  }

  set amount(v: number) {
    this.uniforms.get('uAmount')!.value = v;
  }
}

/**
 * The final composite: our layer pass, then one merged effect pass (bloom, chromatic aberration,
 * vignette, grain) from pmndrs/postprocessing. Switching bloom off (lowest tier) skips its blur
 * passes and zeroes its weight instead of rebuilding the pass, so nothing recompiles mid-scroll.
 */
export class Composite {
  readonly composer: EffectComposer;
  readonly material: ShaderMaterial;
  readonly params = {
    bloomIntensity: 0.95,
    bloomThreshold: 0.6,
    bloomRadius: 0.72,
    caBase: 0.00035,
    caMax: 0.0022,
    grain: 0.045,
    vignette: 0.62,
  };
  private readonly bloom: BloomEffect;
  private readonly ca: ChromaticAberrationEffect;
  private readonly vignette: VignetteEffect;
  private readonly grain: GrainEffect;
  private readonly bloomUpdate: BloomEffect['update'];
  private bloomOn = true;
  /** 0..1 multiplier on bloom (eased down while a card is expanded: halos from the bright scene
   *  next to the card would otherwise spill over its text). */
  bloomScale = 1;
  private readonly caOffset = new Vector2();
  /** The seam's strips in UV units (see seam/Seam.ts). */
  private readonly strips = new Float32Array(MAX_STRIPS * 4);
  /** Extra chromatic aberration while a seam crosses the screen. */
  private cutCA = 0;

  constructor(renderer: WebGLRenderer, camera: Camera, backdrop: Texture, main: Texture, shared: Shared, palette: Palette) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0, depthBuffer: false, stencilBuffer: false });
    this.material = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.composite,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexel: { value: new Vector2() },
        tBackdrop: { value: backdrop },
        tFrom: { value: main },
        tTo: { value: main },
        uCut: { value: 0 },
        uSeam: { value: new Vector2() },
        uBand: { value: 0 },
        uStrips: { value: this.strips },
        uStripCount: { value: 0 },
        uMosaic: { value: SEAM.mosaic },
        uCross: { value: -1 },
        uReveal: { value: 0 },
        uFadeReveal: { value: 0 },
        uFlash: shared.uFlash,
        uTime: shared.uTime,
        uAspect: { value: 1 },
        uBg: { value: palette.bg0 },
        uAccent: shared.uAccent,
      },
    });
    const p = this.params;
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: p.bloomThreshold, luminanceSmoothing: 0.22, intensity: p.bloomIntensity, radius: p.bloomRadius, levels: 7 });
    this.bloomUpdate = this.bloom.update.bind(this.bloom);
    this.ca = new ChromaticAberrationEffect({ offset: new Vector2(p.caBase, p.caBase), radialModulation: true, modulationOffset: 0.2 });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: p.vignette });
    this.grain = new GrainEffect();
    const effects = new EffectPass(camera, this.bloom, this.ca, this.vignette, this.grain);
    effects.dithering = true;
    this.composer.addPass(new LayerPass(this.material));
    this.composer.addPass(effects);
  }

  get reveal() {
    return this.material.uniforms.uReveal as { value: number };
  }

  setFadeReveal(on: boolean) {
    this.material.uniforms.uFadeReveal.value = on ? 1 : 0;
  }

  setBloom(on: boolean) {
    this.bloomOn = on;
    this.bloom.update = on ? this.bloomUpdate : () => {};
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height, false);
    this.material.uniforms.uAspect.value = width / height;
  }

  /** The two worlds on screen: `from` alone, or `from` above the seam and `to` below it. */
  setLayers(from: Texture, to: Texture) {
    const u = this.material.uniforms;
    u.tFrom.value = from;
    u.tTo.value = to;
  }

  /**
   * The cut: seam position and strips (null: no seam). `cross` >= 0 replaces it with a plain
   * crossfade (reduced motion).
   */
  setCut(seam: Seam | null, cross = -1) {
    const u = this.material.uniforms;
    u.uCross.value = cross;
    u.uCut.value = seam && seam.active ? 1 : 0;
    this.cutCA = 0;
    if (!seam || !seam.active) return;
    const H = seam.h;
    const W = seam.w;
    (u.uSeam.value as Vector2).set(1 - seam.l / H, 1 - seam.r / H);
    u.uBand.value = SEAM.band;
    u.uMosaic.value = SEAM.mosaic;
    const s = seam.strips;
    for (let k = 0; k < seam.count; k++) {
      const o = k * 4;
      this.strips[o] = s[o] / H;
      this.strips[o + 1] = s[o + 1] / W;
      this.strips[o + 2] = s[o + 2];
      this.strips[o + 3] = s[o + 3] / W;
    }
    u.uStripCount.value = seam.count;
    // a little more colour split on the whole frame while the band is on screen
    this.cutCA = Math.sin(Math.PI * seam.t);
  }

  update(pointerSpeed: number, valve: number) {
    const p = this.params;
    const k = Math.min(1, Math.max(pointerSpeed / 3, this.cutCA * 0.5));
    const off = p.caBase + (p.caMax - p.caBase) * k;
    this.caOffset.set(off, off * 0.6);
    this.ca.offset.copy(this.caOffset);
    this.grain.amount = p.grain + 0.035 * valve;
    this.vignette.darkness = p.vignette;
    this.bloom.intensity = this.bloomOn ? p.bloomIntensity * this.bloomScale : 0;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.bloom.mipmapBlurPass.radius = p.bloomRadius;
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  get materials() {
    return [this.material];
  }

  dispose() {
    this.composer.dispose();
    this.material.dispose();
  }
}
