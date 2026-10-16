import { Color, Vector4 } from 'three';
import type { Palette } from './theme';

/**
 * Uniforms shared by reference between every material that needs them, so a state tween
 * updates the simulation, the particle draw and the post chain at once.
 */
export function createShared(palette: Palette) {
  return {
    uTime: { value: 0 },
    uBeat: { value: 1.6 },
    uTurb: { value: 1 },
    uKnock: { value: 0 },
    uMisfire: { value: 0 },
    uValve: { value: 0 },
    uStateW: { value: new Vector4() },
    /** Recognition selection (per cluster 0..1) and whether anything is selected; never the state. */
    uClusterSel: { value: new Vector4() },
    uAnySel: { value: 0 },
    uAccent: { value: palette.accent.clone() as Color },
    uFlash: { value: 0 },
  };
}

export type Shared = ReturnType<typeof createShared>;
