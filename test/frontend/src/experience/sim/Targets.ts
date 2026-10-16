import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

// Procedural target shapes, one RGBA float texture per section. Each texel stores the parametric
// coordinates of one particle; shapes.glsl turns them into positions every frame. Particles are
// assigned in random order, so any prefix of the texture still covers every shape evenly (that is
// what lets a quality drop simply draw fewer particles).

export const SECTIONS = ['hero', 'sensors', 'signatures', 'recognition', 'cta'] as const;

/** Recognition clusters, in plot space (-1..1). Shared with the shader and the DOM labels. */
export const CLUSTERS = [
  { key: 'healthy', label: 'Healthy', c: [-0.44, 0.34], share: 0.31, lumps: [[0, 0, 0.17, 0.12, 0.4], [0.14, -0.08, 0.1, 0.07, -0.3], [-0.16, 0.06, 0.08, 0.06, 0.9]] },
  { key: 'knock', label: 'Knock', c: [0.5, 0.5], share: 0.21, lumps: [[0, 0, 0.11, 0.08, -0.6], [0.12, 0.06, 0.07, 0.05, 0.2], [-0.1, -0.07, 0.06, 0.05, 0.0]] },
  { key: 'misfire', label: 'Misfire', c: [0.46, -0.44], share: 0.21, lumps: [[0, 0, 0.12, 0.1, 0.8], [-0.12, -0.05, 0.07, 0.06, 0.1], [0.1, 0.1, 0.05, 0.05, 0.0]] },
  { key: 'valve', label: 'Valve wear', c: [-0.38, -0.5], share: 0.21, lumps: [[0, 0, 0.13, 0.07, 0.15], [0.12, 0.05, 0.08, 0.05, -0.5], [-0.13, 0.04, 0.06, 0.05, 0.4]] },
] as const;

export type ClusterKey = (typeof CLUSTERS)[number]['key'];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rand: () => number) {
  return (clip = 2.5) => {
    const u = Math.max(rand(), 1e-7);
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    return Math.max(-clip, Math.min(clip, g));
  };
}

function texture(data: Float32Array<ArrayBuffer>, side: number) {
  const t = new DataTexture(data, side, side, RGBAFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

type Fill = (out: Float32Array, i: number, rand: () => number, gauss: (clip?: number) => number) => void;

const FILLS: Fill[] = [
  // 0 hero ribbon: arc position, thickness offset, depth offset, random
  (o, i, r, g) => {
    o[i] = r() * 2 - 1;
    o[i + 1] = g();
    o[i + 2] = g();
    o[i + 3] = r();
  },
  // 1 sensor array (see shapes.glsl): pool code, flow phase, radius 0..1, angle.
  //   10% deep-field dust (8), 25% trickles on each sensor's path (10 + sensor),
  //   55% the active sensor's phenomenon flow (20), 10% its data dashes (30)
  (o, i, r) => {
    const pick = r();
    if (pick < 0.1) o[i] = 8;
    else if (pick < 0.35) o[i] = 10 + Math.floor(r() * 8);
    else if (pick < 0.9) o[i] = 20;
    else o[i] = 30;
    o[i + 1] = r();
    o[i + 2] = o[i] === 8 ? Math.pow(r(), 0.7) : r();
    o[i + 3] = r();
  },
  // 2 spectrogram: column, height fraction, time row (more particles in the front rows), jitter
  (o, i, r) => {
    o[i] = r();
    o[i + 1] = Math.pow(r(), 0.85);
    o[i + 2] = Math.pow(r(), 1.7);
    o[i + 3] = r();
  },
  // 3 clusters: plot x, plot y, depth, cluster id (4 = outlier between clusters)
  (o, i, r, g) => {
    let pick = r();
    let k = 0;
    if (pick > 0.96) {
      o[i] = r() * 1.6 - 0.8;
      o[i + 1] = r() * 1.6 - 0.8;
      o[i + 2] = g() * 0.5;
      o[i + 3] = 4;
      return;
    }
    pick /= 0.96;
    while (k < CLUSTERS.length - 1 && pick > CLUSTERS[k].share) {
      pick -= CLUSTERS[k].share;
      k++;
    }
    const cl = CLUSTERS[k];
    const lump = cl.lumps[Math.floor(r() * cl.lumps.length)];
    const [dx, dy, sx, sy, rot] = lump;
    const gx = g(2.2) * sx;
    const gy = g(2.2) * sy;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    o[i] = cl.c[0] + dx + gx * c - gy * s;
    o[i + 1] = cl.c[1] + dy + gx * s + gy * c;
    o[i + 2] = g() * 0.35;
    o[i + 3] = k;
  },
  // 4 CTA ring: angle, radial offset, depth offset, random (r < 0.18 forms the faint outer ring)
  (o, i, r, g) => {
    o[i] = r();
    o[i + 1] = g();
    o[i + 2] = g();
    o[i + 3] = r();
  },
];

export interface TargetSet {
  targets: DataTexture[];
  /** Spawn positions: a tight seed at the centre that bursts into the hero ribbon. */
  spawn: DataTexture;
  /** Per-particle randoms, shared by the simulation (as a texture) and the draw (as an attribute). */
  rand: Float32Array;
  randTexture: DataTexture;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Builds every target, yielding a frame between them so the preloader keeps counting. */
export async function generateTargets(side: number, onStep: (done: number, total: number) => void): Promise<TargetSet> {
  const n = side * side;
  const rand = mulberry32(0x70a0e);
  const gauss = makeGauss(rand);
  const total = FILLS.length + 1;
  const targets: DataTexture[] = [];

  for (let t = 0; t < FILLS.length; t++) {
    const data = new Float32Array(n * 4);
    const fill = FILLS[t];
    for (let p = 0; p < n; p++) fill(data, p * 4, rand, gauss);
    targets.push(texture(data, side));
    onStep(t + 1, total);
    await nextFrame();
  }

  const spawnData = new Float32Array(n * 4);
  const randData = new Float32Array(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = 0.25 * Math.cbrt(rand());
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(rand() * 2 - 1);
    spawnData[i] = r * Math.sin(ph) * Math.cos(th);
    spawnData[i + 1] = r * Math.sin(ph) * Math.sin(th) + 0.4;
    spawnData[i + 2] = r * Math.cos(ph);
    spawnData[i + 3] = 1;
    randData[i] = rand();
    randData[i + 1] = rand();
    randData[i + 2] = rand();
    randData[i + 3] = rand();
  }
  onStep(total, total);

  return { targets, spawn: texture(spawnData, side), rand: randData, randTexture: texture(randData, side) };
}
