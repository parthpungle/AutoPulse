import { FloatType, HalfFloatType } from 'three';
import type { TextureDataType, WebGLRenderer } from 'three';

/** Float32 render targets where the GPU can render to them, half floats otherwise. */
export function simTextureType(renderer: WebGLRenderer): TextureDataType {
  return renderer.extensions.has('EXT_color_buffer_float') ? FloatType : HalfFloatType;
}

export function canRenderHalfFloat(renderer: WebGLRenderer): boolean {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}
