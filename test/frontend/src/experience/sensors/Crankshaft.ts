import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, Shape } from 'three';
import type { BufferGeometry, Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A procedural four-cylinder crankshaft standing on the Y axis (no loaded models):
 * snout + timing gear and the 60-2 trigger wheel at the top, five main journals, four crank pins
 * in the 180° layout (1 & 4 on +X, 2 & 3 on -X), teardrop webs with counterweights opposite each
 * pin, and a flywheel flange at the bottom. Everything shares one material, so it is merged into
 * a single mesh (one draw call).
 */

export interface CrankDims {
  /** World Y of the top of the snout and of the bottom of the flange. */
  top: number;
  bottom: number;
  /** Radius swept by the counterweights (the crank's visual half-width). */
  swing: number;
  /** World Y of each main journal centre (top to bottom) and each pin centre. */
  journals: number[];
  pins: number[];
  /** World Y of the trigger wheel and its outer tooth radius. */
  triggerY: number;
  triggerR: number;
}

const S = 1.25; // overall scale
const RJ = 0.3 * S; // main journal radius
const RP = 0.27 * S; // pin radius
const THROW = 0.55 * S; // pin offset from the axis
const LJ = 0.42 * S;
const LP = 0.5 * S;
const TW = 0.2 * S; // web thickness
const CW = 0.92 * S; // counterweight radius

/** Web outline in its own plane: a lobe around the pin (+x) and a counterweight arc (-x). */
function webShape() {
  const s = new Shape();
  const pr = RP + 0.14 * S;
  const a0 = (100 * Math.PI) / 180;
  s.moveTo(THROW, -pr);
  s.absarc(THROW, 0, pr, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(Math.cos(a0) * CW, Math.sin(a0) * CW);
  s.absarc(0, 0, CW, a0, Math.PI * 2 - a0, false);
  s.lineTo(THROW, -pr);
  return s;
}

/** A toothed disc; `gapTeeth` teeth are left out (60-2 trigger wheel). */
function gearShape(outer: number, inner: number, teeth: number, gapTeeth = 0) {
  const s = new Shape();
  const step = (Math.PI * 2) / teeth;
  let first = true;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const missing = i >= teeth - gapTeeth;
    const r1 = missing ? inner : outer;
    const pts: [number, number][] = [
      [inner, a],
      [r1, a + step * 0.12],
      [r1, a + step * 0.5],
      [inner, a + step * 0.62],
    ];
    for (const [r, ang] of pts) {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (first) {
        s.moveTo(x, y);
        first = false;
      } else s.lineTo(x, y);
    }
  }
  s.closePath();
  return s;
}

/** Extrude a flat shape into a slab lying in the XZ plane, thickness along +Y. */
function slab(shape: Shape, thickness: number, curveSegments: number, bevel: number) {
  const g = new ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

function cyl(r: number, h: number, radial: number) {
  return new CylinderGeometry(r, r, h, radial, 1, false);
}

function place(g: BufferGeometry, x: number, y: number, z: number, rotY = 0) {
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g.index ? g.toNonIndexed() : g;
}

export function buildCrankshaft(material: Material, detail: 'high' | 'low', top = 3.6): { group: Group; mesh: Mesh; dims: CrankDims } {
  const radial = detail === 'high' ? 40 : 20;
  const curve = detail === 'high' ? 18 : 8;
  const parts: BufferGeometry[] = [];
  const journals: number[] = [];
  const pins: number[] = [];
  let y = top;

  // snout
  const snoutH = 0.75 * S;
  parts.push(place(cyl(0.2 * S, snoutH, radial), 0, y - snoutH / 2, 0));
  y -= snoutH;
  // timing gear
  const gearT = 0.16 * S;
  parts.push(place(slab(gearShape(0.5 * S, 0.44 * S, 22), gearT, 2, 0.01), 0, y - gearT, 0));
  y -= gearT + 0.06 * S;
  // 60-2 trigger wheel
  const trigT = 0.07 * S;
  const triggerR = 0.84 * S;
  parts.push(place(slab(gearShape(triggerR, triggerR - 0.07 * S, 60, 2), trigT, 1, 0), 0, y - trigT, 0));
  const triggerY = y - trigT / 2;
  y -= trigT + 0.05 * S;
  parts.push(place(cyl(0.24 * S, 0.12 * S, radial), 0, y - 0.06 * S, 0));
  y -= 0.12 * S;

  // journals, webs, pins: J1 W P1 W J2 W P2 W J3 W P3 W J4 W P4 W J5
  const pinSide = [0, Math.PI, Math.PI, 0]; // 1 & 4 on +X, 2 & 3 on -X
  for (let i = 0; i < 5; i++) {
    parts.push(place(cyl(RJ, LJ, radial), 0, y - LJ / 2, 0));
    journals.push(y - LJ / 2);
    y -= LJ;
    if (i === 4) break;
    const rot = pinSide[i];
    parts.push(place(slab(webShape(), TW, curve, 0.03 * S), 0, y - TW, 0, rot));
    y -= TW;
    const px = Math.cos(rot) * THROW;
    const pz = -Math.sin(rot) * THROW;
    parts.push(place(cyl(RP, LP, radial), px, y - LP / 2, pz));
    pins.push(y - LP / 2);
    y -= LP;
    parts.push(place(slab(webShape(), TW, curve, 0.03 * S), 0, y - TW, 0, rot));
    y -= TW;
  }

  // flywheel flange
  parts.push(place(cyl(0.4 * S, 0.2 * S, radial), 0, y - 0.1 * S, 0));
  y -= 0.2 * S;
  const flangeT = 0.14 * S;
  parts.push(place(cyl(1.05 * S, flangeT, radial * 2), 0, y - flangeT / 2, 0));
  y -= flangeT;

  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  const mesh = new Mesh(merged, material);
  mesh.name = 'crankshaft';
  const group = new Group();
  group.add(mesh);
  return {
    group,
    mesh,
    dims: { top, bottom: y, swing: CW, journals, pins, triggerY, triggerR },
  };
}
