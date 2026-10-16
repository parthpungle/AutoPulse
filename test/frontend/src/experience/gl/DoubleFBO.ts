import { WebGLRenderTarget } from 'three';
import type { RenderTargetOptions } from 'three';

/** A read/write pair of render targets for ping-pong passes. */
export class DoubleFBO {
  read: WebGLRenderTarget;
  write: WebGLRenderTarget;

  constructor(width: number, height: number, options: RenderTargetOptions) {
    this.read = new WebGLRenderTarget(width, height, options);
    this.write = new WebGLRenderTarget(width, height, options);
  }

  swap() {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }

  setSize(width: number, height: number) {
    this.read.setSize(width, height);
    this.write.setSize(width, height);
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
  }
}
