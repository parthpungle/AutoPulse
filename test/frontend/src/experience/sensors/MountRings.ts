import { Color, CustomBlending, InstancedMesh, Object3D, OneFactor, RingGeometry, ShaderMaterial, Vector3, ZeroFactor } from 'three';
import type { Shared } from '../Uniforms';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uRingA[8];
varying vec3 vColor;
varying float vA;

void main() {
  // instances 0-7: a steady thin ring per mount; 8-15: a ring that pulses outward and fades
  int sensor = gl_InstanceID - (gl_InstanceID / 8) * 8;
  float pulse = float(gl_InstanceID / 8);
  float ph = fract(uTime * 0.55 + float(sensor) * 0.37);
  vec3 p = position * (1.0 + pulse * 0.55 * ph);
  vA = uRingA[sensor] * mix(0.55, 0.8 * (1.0 - ph) * (1.0 - ph), pulse);
  vColor = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;

void main() {
  gl_FragColor = vec4(vColor * vA, 0.0);
}
`;

/**
 * Thin rings in each sensor's colour marking where it is mounted on the engine, so you can see
 * where every sensor lives even while another one is showcased. One instanced draw: a steady
 * ring and an outward pulse per mount. Additive light, like the particles (alpha untouched).
 */
export class MountRings {
  readonly mesh: InstancedMesh;
  readonly material: ShaderMaterial;
  /** Per-sensor visibility 0..1, set every frame. */
  readonly alpha = new Float32Array(8);

  /** `mounts[i]`: the ring's centre; `normals[i]`: the direction it faces (away from the crank). */
  constructor(mounts: Vector3[], normals: Vector3[], colors: Color[], shared: Shared) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      uniforms: { uTime: shared.uTime, uRingA: { value: this.alpha } },
    });
    const geo = new RingGeometry(0.25, 0.268, 64, 1);
    this.mesh = new InstancedMesh(geo, this.material, 16);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'mount-rings';
    const o = new Object3D();
    const look = new Vector3();
    for (let j = 0; j < 16; j++) {
      const i = j % 8;
      o.position.copy(mounts[i]);
      o.lookAt(look.copy(mounts[i]).add(normals[i]));
      o.updateMatrix();
      this.mesh.setMatrixAt(j, o.matrix);
      this.mesh.setColorAt(j, colors[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
