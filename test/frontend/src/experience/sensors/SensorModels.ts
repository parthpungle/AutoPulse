import { BoxGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Shape, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The eight sensors of the Sensor Array, all procedural (no loaded models). Each builder works
 * Y-up with the sensing tip at -Y and about half a world unit tall; SensorRig turns that tip
 * toward the crankshaft. Parts are merged per material: iridescent metal, dark satin plastic
 * (#121418), brass for threaded parts, plus optional perforated metal (mic grille, lambda shield)
 * and a separate throttle butterfly disc that animates.
 */
/** Material slots (see Materials.ts); `grille` is perforated steel, cut in the shader. */
export type Slot = 'steel' | 'darkSteel' | 'brass' | 'blackPlastic' | 'rubber' | 'ceramic' | 'grille';
export const SLOTS: Slot[] = ['steel', 'darkSteel', 'brass', 'blackPlastic', 'rubber', 'ceramic', 'grille'];

export interface SensorParts {
  geo: Partial<Record<Slot, BufferGeometry | null>>;
  grilleCut: 'hex' | 'slots';
  /** Throttle butterfly (rotates about X with the throttle signal). */
  disc: BufferGeometry | null;
  /** Where the signal stream leaves the sensor, in builder space. */
  tip: Vector3;
  /** The free end of the cable (its data heads to the OBD-II port from here). */
  cableEnd: Vector3;
  /** Flows that pass through the part instead of ending at its tip (throttle bore, clamped cable). */
  through?: Vector3[];
}

type Seg = { radial: number; curve: number };

function ni(g: BufferGeometry) {
  return g.index ? g.toNonIndexed() : g;
}

function merge(parts: BufferGeometry[]): BufferGeometry | null {
  if (!parts.length) return null;
  const list = parts.map(ni);
  // every builder part has position, normal and uv; drop anything else so they merge
  for (const g of list) for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  for (const g of parts) g.dispose();
  return out;
}

function lathe(profile: [number, number][], seg: number) {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
}

function cyl(r: number, h: number, seg: number, y = 0, x = 0, z = 0, sides?: number) {
  const g = new CylinderGeometry(r, r, h, sides ?? seg, 1, false);
  g.translate(x, y, z);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Saw-tooth thread profile between y0 (bottom) and y1, alternating inner/outer radius. */
function threads(rIn: number, rOut: number, y0: number, y1: number, pitch: number): [number, number][] {
  const pts: [number, number][] = [[0, y0], [rIn, y0]];
  for (let y = y0; y < y1 - 1e-6; y += pitch) {
    pts.push([rOut, Math.min(y1, y + pitch * 0.5)]);
    pts.push([rIn, Math.min(y1, y + pitch)]);
  }
  pts.push([0, y1]);
  return pts;
}

function cable(points: [number, number, number][], r: number, seg: Seg) {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)));
  return new TubeGeometry(curve, seg.curve * 3, r, Math.max(6, Math.round(seg.radial / 3)), false);
}

function mic(s: Seg): SensorParts {
  const body = lathe([[0, 0.32], [0.07, 0.32], [0.1, 0.28], [0.1, -0.05], [0.116, -0.07], [0.116, -0.12], [0, -0.12]], s.radial);
  const dome = lathe(
    Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * (Math.PI / 2);
      return [Math.cos(a) * 0.114, -0.12 - Math.sin(a) * 0.16] as [number, number];
    }),
    s.radial,
  );
  const rings = [-0.14, -0.18, -0.22].map((y) => {
    const t = new TorusGeometry(0.113 - (y + 0.14) * -0.25, 0.007, 6, s.radial);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t;
  });
  return {
    geo: { steel: merge(rings), blackPlastic: merge([body]), rubber: merge([cable([[0, 0.32, 0], [0, 0.5, 0.04], [0.06, 0.68, -0.08], [0.12, 0.84, -0.3]], 0.018, s)]), grille: merge([dome]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.28, 0),
    cableEnd: new Vector3(0.12, 0.84, -0.3),
  };
}

function accelerometer(s: Seg): SensorParts {
  const hex = cyl(0.16, 0.14, s.radial, 0, 0, 0, 6);
  const cap = cyl(0.1, 0.06, s.radial, 0.1);
  const stud = lathe(threads(0.042, 0.054, -0.32, -0.07, 0.02), s.radial);
  const conn = box(0.14, 0.09, 0.12, 0.2, 0.01, 0);
  const plug = cyl(0.03, 0.05, 10, 0.01, 0.29, 0);
  plug.rotateZ(Math.PI / 2);
  return {
    geo: { darkSteel: merge([hex]), blackPlastic: merge([cap, conn]), rubber: merge([cable([[0.27, 0.01, 0], [0.42, 0.04, 0], [0.58, 0.18, 0.05], [0.7, 0.42, 0.1]], 0.016, s)]), brass: merge([stud]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.32, 0),
    cableEnd: new Vector3(0.7, 0.42, 0.1),
  };
}

function crankSensor(s: Seg): SensorParts {
  const body = cyl(0.07, 0.42, s.radial, 0.03);
  const tipCap = cyl(0.05, 0.05, s.radial, -0.205);
  const tab = box(0.3, 0.03, 0.13, 0.06, 0.08, 0);
  const bolt = cyl(0.028, 0.06, 12, 0.08, 0.17, 0);
  const conn = box(0.11, 0.11, 0.09, 0, 0.29, 0);
  return {
    geo: { steel: merge([tipCap]), blackPlastic: merge([body, tab, conn]), rubber: merge([cable([[0, 0.34, 0], [0, 0.5, 0.06], [0.1, 0.66, 0.18], [0.24, 0.78, 0.36]], 0.016, s)]), brass: merge([bolt]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.24, 0),
    cableEnd: new Vector3(0.24, 0.78, 0.36),
  };
}

function coolant(s: Seg): SensorParts {
  const probe = lathe([[0, -0.32], [0.032, -0.32], [0.038, -0.29], [0.038, -0.13], [0, -0.13]], s.radial);
  const thread = lathe(threads(0.048, 0.058, -0.13, -0.01, 0.018), s.radial);
  const nut = cyl(0.1, 0.07, s.radial, 0.03, 0, 0, 6);
  const housing = cyl(0.074, 0.16, s.radial, 0.15);
  const pins = [cyl(0.01, 0.06, 8, 0.25, -0.022), cyl(0.01, 0.06, 8, 0.25, 0.022)];
  const shroud = lathe([[0.06, 0.22], [0.074, 0.22], [0.074, 0.3], [0.06, 0.3], [0.06, 0.22]], s.radial);
  return {
    geo: { steel: merge(pins), blackPlastic: merge([housing, shroud]), rubber: merge([cable([[0, 0.3, 0], [0.02, 0.46, 0.05], [0.12, 0.6, 0.15], [0.26, 0.7, 0.32]], 0.016, s)]), brass: merge([probe, thread, nut]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.32, 0),
    cableEnd: new Vector3(0.26, 0.7, 0.32),
  };
}

function throttle(s: Seg): SensorParts {
  // bore: a thick open tube along Y, flanged at both ends
  const bore = lathe([[0.2, -0.13], [0.245, -0.13], [0.245, 0.13], [0.2, 0.13], [0.2, -0.13]], s.radial);
  const flanges = [-0.13, 0.13].map((y) => {
    const t = new TorusGeometry(0.248, 0.018, 6, s.radial);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t;
  });
  const shaft = cyl(0.012, 0.6, 10, 0);
  shaft.rotateZ(Math.PI / 2);
  const housing = box(0.08, 0.17, 0.15, 0.32, 0, 0);
  const conn = box(0.07, 0.07, 0.06, 0.32, 0.12, 0);
  const disc = cyl(0.196, 0.012, s.radial, 0);
  return {
    geo: { steel: merge([bore, ...flanges]), darkSteel: merge([shaft]), blackPlastic: merge([housing, conn]), rubber: merge([cable([[0.32, 0.16, 0], [0.38, 0.32, 0.05], [0.5, 0.44, 0.12], [0.66, 0.5, 0.2]], 0.015, s)]) },
    grilleCut: 'hex',
    disc,
    tip: new Vector3(0.32, -0.08, 0),
    through: [new Vector3(0, -1.3, 0), new Vector3(0, 0, 0), new Vector3(0, 1.3, 0)],
    cableEnd: new Vector3(0.66, 0.5, 0.2),
  };
}

function lambda(s: Seg): SensorParts {
  const thimble = lathe([[0, -0.36], [0.03, -0.355], [0.04, -0.33], [0.04, -0.16], [0, -0.16]], s.radial);
  const shield = lathe([[0.052, -0.35], [0.058, -0.35], [0.058, -0.15], [0.052, -0.15], [0.052, -0.35]], s.radial);
  const thread = lathe(threads(0.05, 0.06, -0.15, -0.08, 0.016), s.radial);
  const hex = cyl(0.09, 0.07, s.radial, -0.045, 0, 0, 6);
  const body = cyl(0.05, 0.22, s.radial, 0.1);
  const boot = lathe([[0.05, 0.2], [0.04, 0.32], [0.022, 0.36], [0, 0.36]], s.radial);
  return {
    geo: { ceramic: merge([thimble]), steel: merge([body]), darkSteel: merge([hex]), blackPlastic: merge([boot]), rubber: merge([cable([[0, 0.36, 0], [0.02, 0.52, 0.06], [0.14, 0.66, 0.16], [0.3, 0.74, 0.34]], 0.016, s)]), brass: merge([thread]), grille: merge([shield]) },
    grilleCut: 'slots',
    disc: null,
    tip: new Vector3(0, -0.36, 0),
    cableEnd: new Vector3(0.3, 0.74, 0.34),
  };
}

function currentClamp(s: Seg): SensorParts {
  // split jaw around a cable that runs through it along Y
  const jaw = new TorusGeometry(0.2, 0.05, 12, s.radial, Math.PI * 2 - 0.4);
  jaw.rotateX(Math.PI / 2);
  jaw.rotateY(0.2 - Math.PI / 2);
  const capA = cyl(0.05, 0.03, 12, 0);
  capA.rotateX(Math.PI / 2);
  capA.translate(0.2 * Math.cos(-0.2 + 0.0), 0, 0.2 * Math.sin(0.2));
  const capB = cyl(0.05, 0.03, 12, 0);
  capB.rotateX(Math.PI / 2);
  capB.translate(0.2 * Math.cos(0.2), 0, -0.2 * Math.sin(0.2));
  const handle = box(0.09, 0.08, 0.32, -0.36, 0, 0);
  handle.rotateY(0);
  const hinge = cyl(0.025, 0.1, 12, 0, -0.2, 0);
  return {
    geo: { steel: merge([capA, capB]), blackPlastic: merge([jaw, handle]), rubber: merge([cable([[0, -0.6, 0], [0, -0.2, 0], [0, 0.2, 0], [0.05, 0.6, 0.05]], 0.03, s)]), brass: merge([hinge]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.3, 0),
    through: [new Vector3(0, -1.4, 0), new Vector3(0, -0.6, 0), new Vector3(0, 0.2, 0), new Vector3(0.05, 0.6, 0.05), new Vector3(0.16, 1.25, 0.16)],
    cableEnd: new Vector3(0.05, 0.6, 0.05),
  };
}

function obd(s: Seg): SensorParts {
  // trapezoid 16-pin connector face, extruded back along +Y, face at -Y
  const shape = new Shape();
  shape.moveTo(-0.22, -0.075);
  shape.lineTo(0.22, -0.075);
  shape.lineTo(0.185, 0.075);
  shape.lineTo(-0.185, 0.075);
  shape.closePath();
  const body = new ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
  body.rotateX(Math.PI / 2);
  body.translate(0, -0.14, 0);
  const sockets: BufferGeometry[] = [];
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 8; k++) {
      const x = -0.168 + k * 0.048 + (row ? 0.008 : 0);
      sockets.push(cyl(0.011, 0.02, 10, -0.15, x, row ? 0.03 : -0.03));
    }
  }
  const strain = box(0.16, 0.08, 0.08, 0, 0.04, 0);
  return {
    geo: { brass: merge(sockets), blackPlastic: merge([body, strain]), rubber: merge([cable([[0, 0.08, 0], [0.02, 0.3, 0.05], [0.12, 0.5, 0.16], [0.3, 0.6, 0.3]], 0.026, s)]) },
    grilleCut: 'hex',
    disc: null,
    tip: new Vector3(0, -0.17, 0),
    cableEnd: new Vector3(0.3, 0.6, 0.3),
  };
}

const BUILDERS = [mic, accelerometer, crankSensor, coolant, throttle, lambda, currentClamp, obd];

export function buildSensor(index: number, detail: 'high' | 'low'): SensorParts {
  const seg: Seg = detail === 'high' ? { radial: 32, curve: 12 } : { radial: 16, curve: 6 };
  return BUILDERS[index](seg);
}
