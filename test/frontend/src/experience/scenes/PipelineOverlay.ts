import { CustomBlending, Mesh, OneFactor, PlaneGeometry, ShaderMaterial, Vector4, ZeroFactor } from 'three';
import { GLSL } from '../shaders';
import type { Shared } from '../Uniforms';

const VERT = /* glsl */ `
uniform vec4 uL2;
varying vec2 vWorld;
void main() {
  // the quad covers the pipeline's region plus a margin; vWorld is its world position (z = 0)
  vec2 c = vec2(uL2.x, uL2.w + 0.5 * uL2.z);
  vWorld = c + position.xy * vec2(uL2.y * 1.1, uL2.z * 1.1);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 0.0, 1.0);
}
`;

/**
 * The signal pipeline's thin lines (clock, window and overlap brackets, knock-band bracket,
 * baseline) on one quad, additive light like the particles (alpha untouched).
 */
export class PipelineOverlay {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor(shared: Shared, L2: Vector4) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: GLSL.pipelineOverlay,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      uniforms: { uL2: { value: L2 }, uTime: shared.uTime, uKnock: shared.uKnock, uStage: { value: 0 }, uOpacity: { value: 0 } },
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'pipeline-overlay';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `stage` 0..3 (scroll), `amount` 0..1 how much the Signatures section is on screen. */
  update(stage: number, amount: number) {
    this.material.uniforms.uStage.value = stage;
    this.material.uniforms.uOpacity.value = amount;
    this.mesh.visible = amount > 0.004;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
