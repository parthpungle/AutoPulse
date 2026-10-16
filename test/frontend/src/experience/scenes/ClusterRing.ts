import { Color, CustomBlending, Mesh, OneFactor, PlaneGeometry, ShaderMaterial, Vector2, ZeroFactor } from 'three';
import type { Layout } from '../Layout';
import { CLUSTERS } from '../sim/Targets';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  // a thin ring with a soft halo either side, breathing slowly
  float ring = 0.55 * exp(-pow((d - 0.86) / 0.02, 2.0)) + 0.18 * exp(-pow((d - 0.86) / 0.09, 2.0));
  ring *= 0.85 + 0.15 * sin(uTime * 1.6);
  gl_FragColor = vec4(uColor * ring * uOpacity, 0.0);
}
`;

/**
 * The soft ring around the selected Recognition cluster, in that cluster's colour. It glides to a
 * new selection and fades out on deselect. Additive light like the particles (alpha untouched).
 */
export class ClusterRing {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly colors = CLUSTERS.map((c) => new Color(c.color));
  private readonly pos = new Vector2();
  private readonly goal = new Vector2();
  private placed = false;

  constructor(time: { value: number }) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0 }, uTime: time },
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.name = 'cluster-ring';
    this.mesh.frustumCulled = false;
  }

  /**
   * `selected` is the cluster index (-1: none), `amount` 0..1 the selection's fade, `near` 0..1 how
   * much the Recognition section is on screen.
   */
  update(dt: number, layout: Layout, selected: number, amount: number, near: number) {
    const u = this.material.uniforms;
    u.uOpacity.value = amount * near;
    this.mesh.visible = u.uOpacity.value > 0.003;
    if (selected < 0 || !this.mesh.visible) {
      if (selected < 0) this.placed = false;
      return;
    }
    const L = layout.L3;
    const c = layout.clusterC[selected];
    this.goal.set(L.x + c.x * L.z, L.y + c.y * L.w);
    if (!this.placed) {
      this.pos.copy(this.goal);
      (u.uColor.value as Color).copy(this.colors[selected]);
      this.placed = true;
    }
    this.pos.lerp(this.goal, 1 - Math.exp(-dt * 8));
    (u.uColor.value as Color).lerp(this.colors[selected], 1 - Math.exp(-dt * 8));
    this.mesh.position.set(this.pos.x, this.pos.y, 0);
    this.mesh.scale.set(0.42 * L.z, 0.42 * L.w, 1);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
