import { Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector2, Vector4 } from 'three';
import type { Texture } from 'three';
import type { Shared } from '../Uniforms';

const VERT = /* glsl */ `
uniform vec4 uL2;
varying vec2 vUv;
varying vec4 vClip;
void main() {
  vUv = uv;
  // a thin, tall panel standing where the packets cross (see common/pipeline.glsl)
  float x = uL2.x - 0.5 * uL2.y + 0.46 * uL2.y;
  vec2 c = vec2(x, uL2.w + 0.5 * uL2.z);
  vec3 wp = vec3(c + position.xy * vec2(0.05 * uL2.y, 1.06 * uL2.z), 0.05);
  vClip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_Position = vClip;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tGlass;
uniform vec2 uGlassTexel;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vClip;
void main() {
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  float x = vUv.x * 2.0 - 1.0;
  // what is behind the prism, bent and split into its colours (a different pull per channel)
  float bend = x * 0.012;
  vec3 g;
  g.r = texture2D(tGlass, suv + vec2(bend * 1.6, 0.0)).r;
  g.g = texture2D(tGlass, suv + vec2(bend * 1.0, 0.0)).g;
  g.b = texture2D(tGlass, suv + vec2(bend * 0.4, 0.0)).b;
  vec2 dx = uGlassTexel * 3.0;
  g = g * 0.6 + 0.1 * (texture2D(tGlass, suv + vec2(dx.x, 0.0)).rgb + texture2D(tGlass, suv - vec2(dx.x, 0.0)).rgb + texture2D(tGlass, suv + vec2(0.0, dx.y)).rgb + texture2D(tGlass, suv - vec2(0.0, dx.y)).rgb);
  // faint cool body, a bright edge on both sides, a slow sheen travelling up it
  float edge = smoothstep(0.55, 1.0, abs(x));
  float sheen = pow(0.5 + 0.5 * sin(vUv.y * 9.0 - uTime * 0.8 + x * 3.0), 6.0);
  vec3 col = g * 0.55 + vec3(0.04, 0.07, 0.1) + vec3(0.5, 0.75, 1.0) * (edge * 0.5 + sheen * 0.12);
  float fade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
  float a = (0.28 + 0.45 * edge) * fade * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * The prism of the TRANSFORM stage: a thin glass panel (the card glass look at low opacity: a
 * blurred, refracted view of what is behind it) that splits what passes through into its colours.
 * Lives in the card scene, drawn after the glass pass.
 */
export class Prism {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor(shared: Shared, L2: Vector4, glass: Texture, texel: Vector2) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      premultipliedAlpha: true,
      blending: NormalBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: { uL2: { value: L2 }, tGlass: { value: glass }, uGlassTexel: { value: texel }, uTime: shared.uTime, uOpacity: { value: 0 } },
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'prism';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `amount` 0..1: how visible the prism is (the TRANSFORM stage, while Signatures is on screen). */
  update(amount: number) {
    this.material.uniforms.uOpacity.value = amount;
    this.mesh.visible = amount > 0.004;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
