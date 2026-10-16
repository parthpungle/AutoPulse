import { Color } from 'three';

/**
 * Design tokens, defined once. `applyThemeCSS()` writes them as CSS variables (landing.css only
 * uses var(...)), and `themePalette()` hands the same values to the shaders as linear colours.
 * Per-sensor colours live with the sensor content in src/content/sensors.ts.
 */
export const THEME = {
  bg0: '#05060C', // page top
  bg1: '#0A0B18', // page bottom
  hazeViolet: '#2B1450',
  hazeTeal: '#0B3B44',
  fog: '#090A16',
  text: '#E9ECEF',
  muted: '#8A90A6',
  accent: '#FF5A1F', // faults and CTA only
  cool: '#4FD1FF', // data labels
} as const;

export type ThemeKey = keyof typeof THEME;
export type Palette = Record<ThemeKey, Color>;

const CSS_NAMES: Record<ThemeKey, string> = {
  bg0: '--bg-0',
  bg1: '--bg-1',
  hazeViolet: '--haze-violet',
  hazeTeal: '--haze-teal',
  fog: '--fog',
  text: '--text',
  muted: '--muted',
  accent: '--accent',
  cool: '--cool',
};

/** Writes every token as a CSS custom property on :root. Call before the first render. */
export function applyThemeCSS(root: HTMLElement = document.documentElement) {
  for (const key of Object.keys(THEME) as ThemeKey[]) root.style.setProperty(CSS_NAMES[key], THEME[key]);
}

/** The tokens as three.js colours (converted to linear working space). */
export function themePalette(): Palette {
  const out = {} as Palette;
  for (const key of Object.keys(THEME) as ThemeKey[]) out[key] = new Color(THEME[key]);
  return out;
}
