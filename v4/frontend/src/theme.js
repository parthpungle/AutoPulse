// Dashboard light/dark theme: data-theme on <html>, remembered per browser. Styles read the tokens in
// styles.css; canvas and WebGL code reads them with cssVar() and re-draws when useTheme() changes.
import { useSyncExternalStore } from 'react';

const KEY = 'ap-theme';
const listeners = new Set();

export const getTheme = () => document.documentElement.dataset.theme || 'dark';

/** Run before the first render so the page never flashes the other theme. */
export function initTheme() {
  let t = 'dark';
  try { if (localStorage.getItem(KEY) === 'light') t = 'light'; } catch { /* storage blocked: stay dark */ }
  document.documentElement.dataset.theme = t;
}

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked: this visit only */ }
  listeners.forEach((fn) => fn());
}

export function useTheme() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getTheme);
}

/** The current value of a CSS custom property on <html>, e.g. cssVar('--accent'). */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
