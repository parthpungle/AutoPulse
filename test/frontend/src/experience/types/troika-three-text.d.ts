// Minimal typings for the parts of troika-three-text (MIT) this project uses.
declare module 'troika-three-text' {
  import type { Color, Material, Mesh } from 'three';

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    letterSpacing: number;
    lineHeight: number | 'normal';
    maxWidth: number;
    anchorX: number | 'left' | 'center' | 'right' | string;
    anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom' | string;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    color: number | string | Color | null;
    fillOpacity: number;
    depthOffset: number;
    sdfGlyphSize: number;
    material: Material;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void;

  export function configureTextBuilder(config: { sdfGlyphSize?: number; useWorker?: boolean; unicodeFontsURL?: string; defaultFontURL?: string }): void;
}
