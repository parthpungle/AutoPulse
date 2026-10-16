/**
 * The data palette (the eight sensors and the four Recognition clusters) is pulled a little toward
 * grey so the page reads calmer: saturation x MUTE, in HSL, lightness unchanged. One knob; cards,
 * flows, lanes, clusters, rings and the DOM chips all take their colours from these values.
 */
export const MUTE = 0.8;

export function mute(hex: string, k = MUTE): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  s *= k;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hue = (h * 6) % 6;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}
