import { Color, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, NormalBlending, OrthographicCamera, PlaneGeometry, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import { GLSL } from '../shaders';

const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
uniform sampler2D tSil;
uniform float uTex;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  // a soft blob on every tier; tier >= 2 adds the model's blurred footprint
  float blob = exp(-r2 * 4.0) * 0.55;
  float sil = texture2D(tSil, vUv).a * smoothstep(1.0, 0.55, sqrt(r2));
  float a = mix(blob, max(sil * 0.8, blob * 0.6), uTex) * uOpacity;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a); // premultiplied: darkens whatever is behind
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float a = texture2D(tSrc, vUv).a * 0.2270;
  a += (texture2D(tSrc, vUv + uDir * 1.385).a + texture2D(tSrc, vUv - uDir * 1.385).a) * 0.3162;
  a += (texture2D(tSrc, vUv + uDir * 3.231).a + texture2D(tSrc, vUv - uDir * 3.231).a) * 0.0703;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

const SIZE = 128;
/** The floor under the model leans this far toward the camera, so the shadow reads as an ellipse. */
const LEAN = (25 * Math.PI) / 180;

/**
 * One soft contact shadow under the showcased sensor, on an invisible floor just below it.
 * Every tier: a radial blob scaled to the model. Tier >= 2: the model's footprint, rendered from
 * above as a black silhouette into a 128² target (orthographic, its meshes on layer 2) and blurred
 * in two passes.
 */
export class ContactShadow {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Layer the showcased model's meshes join for the silhouette pass. */
  static readonly LAYER = 2;
  private readonly rtA = new WebGLRenderTarget(SIZE, SIZE, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly rtB = new WebGLRenderTarget(SIZE, SIZE, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly blur: ShaderMaterial;
  private readonly black = new MeshBasicMaterial({ color: 0x000000, fog: false });
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private readonly u = new Vector3();
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly basis = new Matrix4();
  private readonly clear = new Color();

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      blending: NormalBlending,
      depthWrite: false,
      uniforms: { tSil: { value: this.rtA.texture }, uTex: { value: 0 }, uOpacity: { value: 0 } },
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'contact-shadow';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    // before the particles, which add their light on top
    this.mesh.renderOrder = -1;
    this.blur = new ShaderMaterial({
      vertexShader: GLSL.fullscreenVert,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTexel: { value: new Vector2() }, tSrc: { value: null }, uDir: { value: new Vector2() } },
    });
    this.cam.layers.set(ContactShadow.LAYER);
  }

  /** Put the shadow under a model (world centre and radius); `opacity` 0 hides it. */
  place(center: Vector3, radius: number, camera: Camera, opacity: number, silhouette: boolean) {
    this.mesh.visible = opacity > 0.01;
    this.material.uniforms.uOpacity.value = opacity;
    this.material.uniforms.uTex.value = silhouette ? 1 : 0;
    if (!this.mesh.visible) return;
    const e = camera.matrixWorld.elements;
    this.u.set(e[0], e[1], e[2]).normalize();
    this.up.set(e[4], e[5], e[6]).normalize();
    this.back.set(e[8], e[9], e[10]).normalize();
    this.n.copy(this.up).multiplyScalar(Math.cos(LEAN)).addScaledVector(this.back, Math.sin(LEAN)).normalize();
    this.v.crossVectors(this.n, this.u);
    const size = radius * 2.6;
    this.basis.makeBasis(this.u, this.v, this.n);
    const m = this.mesh.matrix.copy(this.basis).scale(this.up.set(size, size, 1));
    this.up.copy(center).addScaledVector(this.n, -radius);
    m.setPosition(this.up);
    this.mesh.matrixWorld.copy(m);
    // the silhouette camera looks straight down the floor normal at the same square
    const half = size / 2;
    Object.assign(this.cam, { left: -half, right: half, top: half, bottom: -half, near: 0.01, far: radius * 8 });
    this.cam.updateProjectionMatrix();
    this.cam.matrixAutoUpdate = false;
    this.cam.matrix.copy(this.basis).setPosition(this.back.copy(this.up).addScaledVector(this.n, radius * 4));
    this.cam.matrixWorld.copy(this.cam.matrix);
    this.cam.matrixWorldInverse.copy(this.cam.matrixWorld).invert();
  }

  /** Tier >= 2: render and blur the footprint (skipped while hidden). */
  renderSilhouette(renderer: WebGLRenderer, quad: FullscreenQuad, scene: Scene, force = false) {
    if (!force && (!this.mesh.visible || this.material.uniforms.uTex.value < 0.5)) return;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.setClearColor(0x000000, 0);
    const prev = scene.overrideMaterial;
    scene.overrideMaterial = this.black;
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.render(scene, this.cam);
    scene.overrideMaterial = prev;
    renderer.setClearColor(this.clear, alpha);
    const u = this.blur.uniforms;
    u.tSrc.value = this.rtA.texture;
    (u.uDir.value as Vector2).set(1 / SIZE, 0);
    quad.render(renderer, this.blur, this.rtB);
    u.tSrc.value = this.rtB.texture;
    (u.uDir.value as Vector2).set(0, 1 / SIZE);
    quad.render(renderer, this.blur, this.rtA);
  }

  get materials() {
    return [this.black, this.blur];
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.blur.dispose();
    this.black.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
  }
}
