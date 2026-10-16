import { BufferAttribute, BufferGeometry, Color, CustomBlending, OneFactor, Points, ShaderMaterial, Vector2, Vector4, ZeroFactor } from 'three';

const N = 18;

const VERT = /* glsl */ `
uniform vec4 uL2;          // the pipeline region (the fingerprint's barcode)
uniform vec2 uTarget;      // world position of the cluster the fingerprint lands in
uniform float uProgress;   // 0..1 along the flight (scrubbed by the scroll)
uniform float uPointScale;
attribute float aIndex;
varying float vA;
void main() {
  float s = aIndex / ${N}.0;
  // the sprites trail one another: sprite 0 leads, the last one is a third of the way behind
  float p = clamp(uProgress * 1.35 - s * 0.35, 0.0, 1.0);
  vec2 start = vec2(uL2.x - 0.5 * uL2.y + 0.5 * uL2.y, uL2.w + (0.2 + 0.3) * uL2.z);
  vec2 mid = 0.5 * (start + uTarget) + vec2(0.0, 0.18 * uL2.z);
  vec2 q = mix(mix(start, mid, p), mix(mid, uTarget, p), p);
  vec4 mv = modelViewMatrix * vec4(q, 0.1, 1.0);
  gl_Position = projectionMatrix * mv;
  float bump = sin(3.14159 * p);
  vA = bump * (1.0 - 0.6 * s) * step(0.001, uProgress);
  gl_PointSize = max(2.0, uPointScale * (0.16 + 0.12 * (1.0 - s)) * bump / -mv.z);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float f = 1.0 - d;
  gl_FragColor = vec4(uColor * f * f * vA * 3.0, 0.0);
}
`;

/**
 * The fingerprint's hand-off: on the way from Signatures to Recognition a bright comet leaves the
 * barcode and lands in the cluster of the current engine state (Healthy when none is selected).
 * Scrubbed by the section morph, so it reverses when you scroll back. Additive light.
 */
export class Handoff {
  readonly points: Points;
  readonly material: ShaderMaterial;

  constructor(L2: Vector4) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aIndex', new BufferAttribute(Float32Array.from({ length: N }, (_, i) => i), 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      uniforms: { uL2: { value: L2 }, uTarget: { value: new Vector2() }, uProgress: { value: 0 }, uPointScale: { value: 1 }, uColor: { value: new Color() } },
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'handoff';
    this.points.visible = false;
  }

  update(progress: number, target: Vector2, color: Color, pointScale: number) {
    const u = this.material.uniforms;
    u.uProgress.value = progress;
    (u.uTarget.value as Vector2).copy(target);
    (u.uColor.value as Color).copy(color);
    u.uPointScale.value = pointScale;
    this.points.visible = progress > 0.001 && progress < 0.999;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
