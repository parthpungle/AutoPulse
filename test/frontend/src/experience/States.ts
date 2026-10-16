import { gsap } from 'gsap';
import type { Palette } from './palette';
import type { Shared } from './Uniforms';

export type EngineState = 'baseline' | 'healthy' | 'knock' | 'misfire' | 'valve';

interface Preset {
  turb: number;
  knock: number;
  misfire: number;
  valve: number;
  beat: number;
  cool: boolean;
  w: [number, number, number, number];
}

// Every state is a set of uniform targets; selecting one tweens them all.
const PRESETS: Record<EngineState, Preset> = {
  baseline: { turb: 1, knock: 0, misfire: 0, valve: 0, beat: 1.6, cool: false, w: [0, 0, 0, 0] },
  healthy: { turb: 0.5, knock: 0, misfire: 0, valve: 0, beat: 1.4, cool: true, w: [1, 0, 0, 0] },
  knock: { turb: 0.9, knock: 1, misfire: 0, valve: 0, beat: 1.7, cool: false, w: [0, 1, 0, 0] },
  misfire: { turb: 0.85, knock: 0, misfire: 1, valve: 0, beat: 2.0, cool: false, w: [0, 0, 1, 0] },
  valve: { turb: 1.15, knock: 0, misfire: 0, valve: 1, beat: 1.6, cool: false, w: [0, 0, 0, 1] },
};

export function applyState(shared: Shared, palette: Palette, state: EngineState, instant = false) {
  const p = PRESETS[state];
  const duration = instant ? 0 : 0.9;
  const ease = 'power2.inOut';
  gsap.to(shared.uTurb, { value: p.turb, duration, ease, overwrite: true });
  gsap.to(shared.uKnock, { value: p.knock, duration, ease, overwrite: true });
  gsap.to(shared.uMisfire, { value: p.misfire, duration, ease, overwrite: true });
  gsap.to(shared.uValve, { value: p.valve, duration, ease, overwrite: true });
  gsap.to(shared.uBeat, { value: p.beat, duration, ease, overwrite: true });
  const w = shared.uStateW.value;
  gsap.to(w, { x: p.w[0], y: p.w[1], z: p.w[2], w: p.w[3], duration, ease, overwrite: true });
  const c = p.cool ? palette.cool : palette.accent;
  gsap.to(shared.uAccent.value, { r: c.r, g: c.g, b: c.b, duration, ease, overwrite: true });
  if (state === 'knock' && !instant) {
    gsap.fromTo(shared.uFlash, { value: 1 }, { value: 0, duration: 0.7, ease: 'power3.out', overwrite: true });
  }
}
