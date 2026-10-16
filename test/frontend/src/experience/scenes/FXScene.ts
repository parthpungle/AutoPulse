import { HalfFloatType, LinearFilter, RGBAFormat, Scene, WebGLRenderTarget } from 'three';
import type { Camera, Material, WebGLRenderer } from 'three';

/**
 * One visual layer: its own scene, camera and render target. The final composite samples each
 * layer's texture, so section changes are shader transitions rather than DOM swaps.
 */
export abstract class FXScene {
  readonly scene = new Scene();
  readonly rt: WebGLRenderTarget;
  abstract readonly camera: Camera;
  /** Render target size as a fraction of the drawing buffer. */
  protected readonly scale: number;

  protected readonly depth: boolean;

  constructor(scale = 1, depth = false) {
    this.scale = scale;
    this.depth = depth;
    this.rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: depth });
  }

  setSize(bufferWidth: number, bufferHeight: number) {
    this.rt.setSize(Math.max(1, Math.round(bufferWidth * this.scale)), Math.max(1, Math.round(bufferHeight * this.scale)));
  }

  render(renderer: WebGLRenderer) {
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, this.depth, false);
    renderer.render(this.scene, this.camera);
  }

  abstract get materials(): Material[];

  dispose() {
    this.rt.dispose();
  }
}
