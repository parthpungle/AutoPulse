import { Mesh, OrthographicCamera, ShaderMaterial, Vector2 } from 'three';
import type { BufferGeometry } from 'three';
import { GLSL } from '../shaders';
import type { Palette } from '../palette';
import type { Shared } from '../Uniforms';
import { FXScene } from './FXScene';

/** Fullscreen backdrop at half resolution: very dark radial gradient and slow noise. */
export class BackdropScene extends FXScene {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: ShaderMaterial;

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
        uSection: { value: 0 },
        uRes: { value: new Vector2(1, 1) },
        uBg: { value: palette.bg },
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

  update(sectionFloat: number) {
    this.material.uniforms.uSection.value = sectionFloat;
  }

  get materials() {
    return [this.material];
  }

  dispose() {
    super.dispose();
    this.material.dispose();
  }
}
