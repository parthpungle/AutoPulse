import { Color, Mesh, OrthographicCamera, ShaderMaterial, Vector2, Vector4 } from 'three';
import type { BufferGeometry } from 'three';
import { GLSL } from '../shaders';
import type { Palette } from '../theme';
import type { Shared } from '../Uniforms';
import { FXScene } from './FXScene';

/** Fullscreen atmosphere at half resolution (see backdrop.frag.glsl). */
export class BackdropScene extends FXScene {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: ShaderMaterial;
  /** Tunable from ?debug: centre (uv), radius, strength. */
  readonly hazeViolet = new Vector4(0.12, 0.12, 0.78, 0.42);
  readonly hazeTeal = new Vector4(0.9, 0.86, 0.66, 0.36);
  readonly tint = new Color();

  constructor(geometry: BufferGeometry, shared: Shared, palette: Palette) {
    super(0.5);
    this.material = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: GLSL.backdrop,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexel: { value: new Vector2() },
        uTime: shared.uTime,
        uFlash: shared.uFlash,
        uAccent: shared.uAccent,
        uScroll: { value: 0 },
        uTintAmt: { value: 0 },
        uRes: { value: new Vector2(1, 1) },
        uBg0: { value: palette.bg0 },
        uBg1: { value: palette.bg1 },
        uViolet: { value: palette.hazeViolet },
        uTeal: { value: palette.hazeTeal },
        uFog: { value: palette.fog },
        uTint: { value: this.tint },
        uHazeV: { value: this.hazeViolet },
        uHazeT: { value: this.hazeTeal },
        uBand: { value: 0.9 },
      },
    });
    const mesh = new Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  setSize(bufferWidth: number, bufferHeight: number) {
    super.setSize(bufferWidth, bufferHeight);
    (this.material.uniforms.uRes.value as Vector2).set(bufferWidth, bufferHeight);
  }

  /** `tintAmt` 0..1 leans the hazes toward `tint` (the active sensor colour). */
  update(scroll: number, tintAmt: number) {
    const u = this.material.uniforms;
    u.uScroll.value = scroll;
    u.uTintAmt.value = tintAmt;
  }

  get materials() {
    return [this.material];
  }

  dispose() {
    super.dispose();
    this.material.dispose();
  }
}
