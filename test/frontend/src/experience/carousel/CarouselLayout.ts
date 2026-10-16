import { MathUtils, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

/**
 * Geometry of the Sensor Array, the "showcase" layout.
 *
 * The camera orbits the vertical crankshaft one sensor at a time, descending as it goes, and keeps
 * the crank centred (~50% x) in the background. The active sensor flies out of its mount to a
 * showcase spot left of centre; the active card sits in the right third. Both are placed in
 * camera space (fractions of the viewport), so they hold their framing while the engine turns
 * behind them.
 *
 * Inactive cards fan out from the card slot on a virtual helix: for k = i - c, a card moves down
 * (k > 0) or up (k < 0), further back and further right, turns toward the centre (at most 55°,
 * so its front always faces the viewer), shrinks to 0.7 then 0.5 and fades to 35%, then out.
 * They never enter the showcase zone (22–54% x, 18–86% y). Portrait screens: the showcase takes
 * the top of the screen and the cards run in a row along the bottom.
 * Everything keys off one float, the carousel position c (0..7).
 */
export const CAROUSEL = {
  step: (48 * Math.PI) / 180,
  drop: 0.78,
  top: 2.15,
  camRadius: 8.6,
  /** Portrait screens back off a little, so the crank doesn't fill the narrow view. */
  camRadiusPortrait: 11,
  camLift: 0.3,
};

/** Where things sit on screen (fractions of the viewport, y from the top). */
export const SHOWCASE = {
  wide: {
    card: { x: 0.68, y: 0.5, w: 0.34 },
    /** Per step of |k|: shift right, shift down (times k), extra depth (world units), yaw. */
    stack: { x: 0.11, y: 0.37, back: 2.2, yaw: 30 },
    spot: { x: 0.38, y: 0.52, h: 0.33 },
    /** While the card is expanded: centre of the visible left area. */
    spotDetail: { x: 0.28, y: 0.5, h: 0.36 },
  },
  portrait: {
    card: { x: 0.5, y: 0.66, w: 0.86 },
    stack: { x: 0.66, y: 0, back: 2.2, yaw: 24 },
    spot: { x: 0.5, y: 0.3, h: 0.26 },
    spotDetail: { x: 0.5, y: 0.17, h: 0.2 },
  },
  /** Camera distance of the active card and of the showcased sensor. */
  cardDist: 5,
  spotDist: 5.4,
  /** The no-go box for inactive cards (fractions of the viewport). */
  zone: { x0: 0.22, x1: 0.54, y0: 0.18, y1: 0.86 },
};

/** Camera position and look-at for carousel position c: orbiting the crank, centred on it. */
export function orbitPose(c: number, wide: boolean, pos: Vector3, look: Vector3) {
  const a = c * CAROUSEL.step;
  const y = CAROUSEL.top - c * CAROUSEL.drop;
  const r = wide ? CAROUSEL.camRadius : CAROUSEL.camRadiusPortrait;
  pos.set(Math.sin(a) * r, y + CAROUSEL.camLift, Math.cos(a) * r);
  look.set(0, y - 0.05, 0);
}

const yAxis = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();

/** Half the view height at distance d. */
function halfHeight(camera: PerspectiveCamera, d: number) {
  return d * Math.tan(MathUtils.degToRad(camera.fov) / 2);
}

/** A point at viewport fraction (fx, fy) (y from the top), `d` in front of the camera, in world space. */
export function screenToWorld(camera: PerspectiveCamera, fx: number, fy: number, d: number, out: Vector3) {
  const hh = halfHeight(camera, d);
  return out.set((fx * 2 - 1) * hh * camera.aspect, (1 - fy * 2) * hh, -d).applyMatrix4(camera.matrixWorld);
}

/** World size of `frac` of the view height at distance d. */
export function viewHeightAt(camera: PerspectiveCamera, d: number, frac = 1) {
  return 2 * halfHeight(camera, d) * frac;
}

export interface CardSlot {
  /** World-space scale of the card slab (built `cardW` wide). */
  scale: number;
  opacity: number;
}

/**
 * Card pose for k = i - c (fractional while the carousel moves): world position and orientation,
 * plus scale and opacity. `cardW` is the slab's built width in world units.
 */
export function cardSlot(k: number, wide: boolean, camera: PerspectiveCamera, cardW: number, pos: Vector3, quat: Quaternion, out: CardSlot) {
  const L = wide ? SHOWCASE.wide : SHOWCASE.portrait;
  // a smooth |k| (no kink as a card passes through the slot)
  const a = Math.sqrt(k * k + 0.0225) - 0.15;
  const d = SHOWCASE.cardDist + L.stack.back * Math.min(a, 3);
  const fx = L.card.x + L.stack.x * a * (wide ? 1 : Math.sign(k));
  const fy = L.card.y + L.stack.y * k;
  screenToWorld(camera, fx, fy, d, pos);
  // seen size: 1 at the slot, 0.7 one step away, 0.5 two steps away
  const seen = 1 - 0.3 * Math.min(a, 1) - 0.2 * MathUtils.clamp(a - 1, 0, 1);
  const w0 = viewHeightAt(camera, SHOWCASE.cardDist) * camera.aspect * L.card.w;
  out.scale = (w0 / cardW) * seen * (d / SHOWCASE.cardDist);
  // fronts turn toward the screen centre (right-hand cards face left), never past 55°
  const side = wide ? 1 : Math.sign(k);
  const yaw = -side * MathUtils.degToRad(Math.min(55, L.stack.yaw * a));
  quat.copy(camera.quaternion).multiply(tmpQ.setFromAxisAngle(yAxis, yaw));
  out.opacity = stackOpacity(a);
  return out;
}

/** 1 at the slot, 35% one step away, 12% two steps away, then out. */
function stackOpacity(a: number) {
  if (a < 1) return MathUtils.lerp(1, 0.35, a);
  if (a < 2) return MathUtils.lerp(0.35, 0.12, a - 1);
  return Math.max(0, 0.12 * (1 - (a - 2) / 0.6));
}

/**
 * The showcase spot for the active sensor, blended toward the expanded-card framing by `detail`
 * (0..1). Writes the world position; returns the world height the model should fill.
 */
export function showcaseSpot(camera: PerspectiveCamera, wide: boolean, detail: number, out: Vector3) {
  const L = wide ? SHOWCASE.wide : SHOWCASE.portrait;
  const fx = MathUtils.lerp(L.spot.x, L.spotDetail.x, detail);
  const fy = MathUtils.lerp(L.spot.y, L.spotDetail.y, detail);
  const h = MathUtils.lerp(L.spot.h, L.spotDetail.h, detail);
  screenToWorld(camera, fx, fy, SHOWCASE.spotDist, out);
  return viewHeightAt(camera, SHOWCASE.spotDist, h);
}
