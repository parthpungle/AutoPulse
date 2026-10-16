import { Color } from 'three';

// The palette is defined once, as CSS variables in landing.css; the engine reads the same values.
const FALLBACK = {
  bg: '#07080A',
  text: '#E9ECEF',
  muted: '#7A828C',
  accent: '#FF5A1F',
  cool: '#4FD1FF',
};

export type PaletteKey = keyof typeof FALLBACK;
export type Palette = Record<PaletteKey, Color>;

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const key of Object.keys(FALLBACK) as PaletteKey[]) {
    const v = css.getPropertyValue(`--${key}`).trim();
    out[key] = new Color(v || FALLBACK[key]);
  }
  return out;
}
