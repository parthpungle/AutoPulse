import type { Vector3 } from 'three';

/**
 * Geometry of the Sensor Array. Cards sit on a gentle helix around the crankshaft (Y axis):
 * card i at angle i·STEP and height TOP − i·DROP, facing outward. The camera orbits the same
 * helix one card at a time, so whichever card is active faces it front and centre while its
 * neighbours turn away by about ±STEP. Portrait screens use a flat row instead.
 * Everything keys off one float, the carousel position c (0..7).
 */
export const CAROUSEL = {
  step: (48 * Math.PI) / 180,
  drop: 0.78,
  top: 2.15,
  cardRadius: 3.55,
  camRadius: 8.6,
  /** The camera leads the card slightly so the crank sits right of centre (~55%). */
  camLead: 0.2,
  camLift: 0.3,
  /** Look-at point: this far from the axis toward the card. */
  lookIn: 1.25,
  /** Portrait row: spacing between cards and the row's distance in front of the crank. */
  rowGap: 3.2,
  rowZ: 3.4,
};

/** Camera position and look-at for carousel position c. */
export function orbitPose(c: number, wide: boolean, pos: Vector3, look: Vector3) {
  if (!wide) {
    pos.set(0, 0.35, CAROUSEL.rowZ + 7.2);
    look.set(0, 0.2, 0);
    return;
  }
  const a = c * CAROUSEL.step;
  const y = CAROUSEL.top - c * CAROUSEL.drop;
  const ac = a + CAROUSEL.camLead;
  pos.set(Math.sin(ac) * CAROUSEL.camRadius, y + CAROUSEL.camLift, Math.cos(ac) * CAROUSEL.camRadius);
  look.set(Math.sin(a) * CAROUSEL.lookIn, y - 0.05, Math.cos(a) * CAROUSEL.lookIn);
}

/** Card i's centre and Y rotation for carousel position c (the row layout moves with c). */
export function cardPose(i: number, c: number, wide: boolean, pos: Vector3): number {
  if (!wide) {
    pos.set((i - c) * CAROUSEL.rowGap, 0.2, CAROUSEL.rowZ);
    return 0;
  }
  const a = i * CAROUSEL.step;
  pos.set(Math.sin(a) * CAROUSEL.cardRadius, CAROUSEL.top - i * CAROUSEL.drop, Math.cos(a) * CAROUSEL.cardRadius);
  return a;
}
