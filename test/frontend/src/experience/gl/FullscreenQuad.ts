import { BufferAttribute, BufferGeometry, Mesh, OrthographicCamera, Scene } from 'three';
import type { Material, WebGLRenderer, WebGLRenderTarget } from 'three';

/** One fullscreen triangle shared by every GPGPU and post pass; only its material changes. */
export class FullscreenQuad {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly scene = new Scene();
  readonly geometry = new BufferGeometry();
  readonly mesh: Mesh;

  constructor() {
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: WebGLRenderer, material: Material, target: WebGLRenderTarget | null) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
  }
}
