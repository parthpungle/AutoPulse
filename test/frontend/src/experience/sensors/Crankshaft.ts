import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, Shape } from 'three';
import type { BufferGeometry, Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A procedural inline-four crankshaft standing on the Y axis (no loaded models), built like the
 * real part:
 *  - five main journals on the axis and four crank pins offset by the stroke radius
 *    (0.45 x journal spacing) in the 180-degree layout: pins 1 & 4 on one side, 2 & 3 opposite
 *  - each web is a rounded slot (two circles joined by their tangents) from journal to pin, with a
 *    half-moon counterweight opposite the pin; every edge is bevelled (~2%) to catch a highlight
 *  - snout with a timing gear about the size of a web at the top; the 60-2 trigger wheel just above
 *    the flywheel flange at the bottom
 * Two meshes: the steel body and the polished bearing surfaces (journals and pins).
 */
export interface CrankDims {
  top: number;
  bottom: number;
  /** Radius swept by the counterweights (the crank's visual half-width). */
  swing: number;
  journals: number[];
  pins: number[];
  /** Centre Y and outer radius of the 60-2 trigger wheel. */
  triggerY: number;
  triggerR: number;
}

const RJ = 0.3; // main journal radius
const RP = 0.26; // pin radius
const LJ = 0.38; // journal length
const LP = 0.42; // pin length
const TW = 0.2; // web thickness
const SPACING = LJ + 2 * TW + LP; // journal-to-journal distance
const STROKE = 0.45 * SPACING; // pin offset from the axis
const WEB_J = RJ + 0.13; // web end radius around the journal
const WEB_P = RP + 0.11; // web end radius around the pin
const CW = 0.92; // counterweight radius
const BEVEL = 0.018;

/** Rounded slot from the journal (origin) to the pin (+x at STROKE): two circles and their tangents. */
function webShape() {
  const d = STROKE;
  const psi = Math.acos((WEB_J - WEB_P) / d); // angle of the shared tangent normal
  const s = new Shape();
  s.moveTo(Math.cos(psi) * WEB_J, Math.sin(psi) * WEB_J);
  s.absarc(0, 0, WEB_J, psi, Math.PI * 2 - psi, false);
  s.lineTo(d + Math.cos(-psi) * WEB_P, Math.sin(-psi) * WEB_P);
  s.absarc(d, 0, WEB_P, -psi, psi, false);
  s.closePath();
  return s;
}

/** Half-moon counterweight on the side opposite the pin (-x). */
function counterweightShape() {
  const a0 = (118 * Math.PI) / 180;
  const a1 = Math.PI * 2 - a0;
  const s = new Shape();
  s.moveTo(Math.cos(a0) * CW, Math.sin(a0) * CW);
  s.absarc(0, 0, CW, a0, a1, false);
  // inner edge: a shallow arc back past the journal
  s.absarc(0, 0, WEB_J * 0.9, a1, a0, true);
  s.closePath();
  return s;
}

/** A toothed disc; the last `gapTeeth` teeth are left out (60-2 trigger wheel). */
function gearShape(outer: number, inner: number, teeth: number, gapTeeth = 0) {
  const s = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const r1 = i >= teeth - gapTeeth ? inner : outer;
    const pts: [number, number][] = [
      [inner, a],
      [r1, a + step * 0.14],
      [r1, a + step * 0.48],
      [inner, a + step * 0.62],
    ];
    pts.forEach(([r, ang], k) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  return s;
}

/** Extrude a flat shape into a slab in the XZ plane, `thickness` tall along Y, top at y = 0. */
function slab(shape: Shape, thickness: number, curveSegments: number, bevel = BEVEL) {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - bevel * 2),
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  g.rotateX(Math.PI / 2); // extrusion now runs down -Y; the shape's +y maps to +z
  g.translate(0, -bevel, 0);
  return g;
}

function cyl(r: number, h: number, radial: number, rTop = r) {
  return new CylinderGeometry(rTop, r, h, radial, 1, false);
}

function place(g: BufferGeometry, x: number, y: number, z: number, rotY = 0) {
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g.index ? g.toNonIndexed() : g;
}

function merge(parts: BufferGeometry[]) {
  for (const g of parts) for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}

export function buildCrankshaft(bodyMat: Material, bearingMat: Material, detail: 'high' | 'low', top = 3.5): { group: Group; body: Mesh; bearings: Mesh; dims: CrankDims } {
  const radial = detail === 'high' ? 40 : 20;
  const curve = detail === 'high' ? 16 : 8;
  const body: BufferGeometry[] = [];
  const bearings: BufferGeometry[] = [];
  const journals: number[] = [];
  const pins: number[] = [];
  let y = top;

  // snout with a small pulley stub, then the timing gear (about a web's size)
  body.push(place(cyl(0.16, 0.18, radial), 0, y - 0.09, 0));
  y -= 0.18;
  body.push(place(cyl(0.2, 0.42, radial), 0, y - 0.21, 0));
  y -= 0.42;
  body.push(place(slab(gearShape(WEB_J + 0.03, WEB_J - 0.03, 24), 0.15, 2, 0.008), 0, y, 0));
  y -= 0.15;
  body.push(place(cyl(0.24, 0.08, radial), 0, y - 0.04, 0));
  y -= 0.08;

  // J1 W P1 W J2 W P2 W J3 W P3 W J4 W P4 W J5
  const side = [0, Math.PI, Math.PI, 0]; // pins 1 & 4 at +X, 2 & 3 at -X
  for (let i = 0; i < 5; i++) {
    bearings.push(place(cyl(RJ, LJ, radial), 0, y - LJ / 2, 0));
    journals.push(y - LJ / 2);
    y -= LJ;
    if (i === 4) break;
    const rot = side[i];
    const px = Math.cos(rot) * STROKE;
    const pz = -Math.sin(rot) * STROKE;
    for (const k of [0, 1]) {
      body.push(place(slab(webShape(), TW, curve), 0, y, 0, rot));
      body.push(place(slab(counterweightShape(), TW, curve), 0, y, 0, rot));
      y -= TW;
      if (k === 0) {
        bearings.push(place(cyl(RP, LP, radial), px, y - LP / 2, pz));
        pins.push(y - LP / 2);
        y -= LP;
      }
    }
  }

  // rear: short spigot, the 60-2 trigger wheel, then the flywheel flange
  body.push(place(cyl(0.26, 0.12, radial), 0, y - 0.06, 0));
  y -= 0.12;
  const triggerR = 0.74;
  const trigT = 0.06;
  body.push(place(slab(gearShape(triggerR, triggerR - 0.06, 60, 2), trigT, 1, 0), 0, y, 0));
  const triggerY = y - trigT / 2;
  y -= trigT + 0.05;
  body.push(place(cyl(0.42, 0.14, radial), 0, y - 0.07, 0));
  y -= 0.14;
  const flange = 0.12;
  body.push(place(cyl(1.02, flange, radial * 2, 0.98), 0, y - flange / 2, 0));
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2;
    body.push(place(cyl(0.05, 0.03, 12), Math.cos(a) * 0.62, y + 0.012, Math.sin(a) * 0.62));
  }
  y -= flange;

  const bodyMesh = new Mesh(merge(body), bodyMat);
  bodyMesh.name = 'crank-body';
  const bearingMesh = new Mesh(merge(bearings), bearingMat);
  bearingMesh.name = 'crank-bearings';
  const group = new Group();
  group.add(bodyMesh, bearingMesh);
  return { group, body: bodyMesh, bearings: bearingMesh, dims: { top, bottom: y, swing: CW, journals, pins, triggerY, triggerR } };
}
