import { BoxGeometry, Color, DirectionalLight, FogExp2, Group, Mesh, MeshBasicMaterial, PMREMGenerator, PointLight, Vector3 } from 'three';
import type { BufferGeometry, Camera, Material, MeshPhysicalMaterial, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SENSORS } from '../../content/sensors';
import { CAROUSEL, cardPose } from '../carousel/CarouselLayout';
import type { SyntheticSignals } from '../signals/SyntheticSignals';
import type { Palette } from '../theme';
import { buildCrankshaft } from './Crankshaft';
import type { CrankDims } from './Crankshaft';
import { disposeSet, makeHighSet, makeLowSet, makePerforated, setDim } from './Materials';
import type { MaterialSet } from './Materials';
import { buildSensor } from './SensorModels';

/**
 * three.js RoomEnvironment (a neutral studio box), plus three tinted light panels so the
 * iridescent metal picks up the page's violet, teal and magenta. Baked once through PMREM.
 */
function bakeEnvironment(renderer: WebGLRenderer) {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const extras: Mesh[] = [];
  const panel = (hex: string, strength: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(strength) }));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    room.add(m);
    extras.push(m);
  };
  panel('#7B5CFF', 9, -6.5, 2, 0, 0.1, 6, 7); // violet wall light, left
  panel('#22D3EE', 7, 6.5, 4, -2, 0.1, 4, 6); // teal, right
  panel('#FF4FD8', 6, 0, -5, 6, 8, 0.1, 3); // magenta bounce from below
  const target = pmrem.fromScene(room, 0.04);
  for (const m of extras) {
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
  }
  room.dispose();
  pmrem.dispose();
  return target;
}

type Slot = 'metal' | 'plastic' | 'brass' | 'grille';

interface SensorInst {
  outer: Group;
  inner: Group;
  meshes: { mesh: Mesh; slot: Slot }[];
  disc: Mesh | null;
  /** Per-sensor material clones (shared programs), so each sensor can dim on its own. */
  high: Record<Slot, Material>;
  low: Record<Slot, Material>;
  base: Record<Slot, Color>;
  rest: Vector3;
  tip: Vector3;
  focus: number;
  drift: number;
  geometries: BufferGeometry[];
}

const SENSOR_SCALE = 1.1;
const SLOTS: Slot[] = ['metal', 'plastic', 'brass', 'grille'];

/**
 * Everything solid in the Sensor Array: the crankshaft, the eight sensor models, their lights and
 * the procedural environment (RoomEnvironment through PMREM, no HDR files). The rig rises out of
 * the fog floor as the section arrives and sinks as the page moves on. The active card's sensor
 * drifts toward the camera, grows to 1.4x and picks up a rim light in its colour; the others dim.
 */
export class SensorRig {
  readonly group = new Group();
  /** Rotates with the crank angle (crank, trigger wheel). */
  readonly spin = new Group();
  readonly dims: CrankDims;
  readonly crank: Mesh;
  readonly fog: FogExp2;
  readonly high: MaterialSet;
  readonly low: MaterialSet;
  readonly sensors: SensorInst[] = [];
  readonly rim = new PointLight(0xffffff, 0, 3.5, 2);
  private env: WebGLRenderTarget | null = null;
  private highTier = true;
  private readonly lights: DirectionalLight[] = [];
  private readonly highGrille: { hex: MeshPhysicalMaterial; slots: MeshPhysicalMaterial };
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly focusPos = new Vector3();
  private readonly target = new Vector3();
  private readonly cardPos = new Vector3();
  private readonly colors = SENSORS.map((s) => new Color(s.color));

  constructor(renderer: WebGLRenderer, palette: Palette, highTier: boolean) {
    this.high = makeHighSet();
    this.low = makeLowSet(palette);
    this.highTier = highTier;
    this.highGrille = {
      hex: makePerforated(this.high.metal as MeshPhysicalMaterial, 'hex'),
      slots: makePerforated(this.high.metal as MeshPhysicalMaterial, 'slots'),
    };

    this.env = bakeEnvironment(renderer);

    const built = buildCrankshaft(this.set.metal, highTier ? 'high' : 'low');
    this.crank = built.mesh;
    this.dims = built.dims;
    this.spin.add(built.group);
    this.group.add(this.spin);

    for (let i = 0; i < SENSORS.length; i++) this.sensors.push(this.buildSensor(i, highTier));

    // a cool key from the upper right and a violet fill from the lower left, matching the hazes;
    // the rim light always exists (constant light count, so no program ever recompiles)
    const key = new DirectionalLight(new Color('#7FE3FF'), 1.4);
    key.position.set(4, 6, 3);
    const fill = new DirectionalLight(new Color('#9B7BFF'), 1.0);
    fill.position.set(-5, -3, 2);
    this.lights.push(key, fill);
    this.group.add(key, fill, this.rim);

    this.fog = new FogExp2(palette.fog.getHex(), 0.05);
  }

  private buildSensor(i: number, highTier: boolean): SensorInst {
    const parts = buildSensor(i, highTier ? 'high' : 'low');
    const outer = new Group();
    const inner = new Group();
    inner.rotation.x = -Math.PI / 2; // builder space has the tip at -Y; this turns it to +Z
    outer.add(inner);
    const grille = this.highGrille[i === 5 ? 'slots' : 'hex'];
    const high: Record<Slot, Material> = {
      metal: this.high.metal.clone(),
      plastic: this.high.plastic.clone(),
      brass: this.high.brass.clone(),
      grille: grille.clone(),
    };
    // keep the perforation hook on the clone (same cache key, so the program is shared)
    (high.grille as MeshPhysicalMaterial).onBeforeCompile = grille.onBeforeCompile;
    (high.grille as MeshPhysicalMaterial).customProgramCacheKey = grille.customProgramCacheKey;
    const low: Record<Slot, Material> = {
      metal: this.low.metal.clone(),
      plastic: this.low.plastic.clone(),
      brass: this.low.brass.clone(),
      grille: this.low.metal.clone(),
    };
    const base = {} as Record<Slot, Color>;
    for (const slot of SLOTS) base[slot] = (high[slot] as MeshPhysicalMaterial).color.clone();

    const meshes: { mesh: Mesh; slot: Slot }[] = [];
    const geometries: BufferGeometry[] = [];
    for (const slot of SLOTS) {
      const g = parts[slot];
      if (!g) continue;
      const mesh = new Mesh(g, highTier ? high[slot] : low[slot]);
      inner.add(mesh);
      meshes.push({ mesh, slot });
      geometries.push(g);
    }
    let disc: Mesh | null = null;
    if (parts.disc) {
      disc = new Mesh(parts.disc, highTier ? high.metal : low.metal);
      inner.add(disc);
      geometries.push(parts.disc);
    }

    // rest: ahead of its card on the helix, between the crank and the cards, tip toward the axis.
    // The crank position sensor sits at the 60-2 trigger wheel, tip facing the teeth.
    const a = i * CAROUSEL.step + 0.5;
    let y = CAROUSEL.top - i * CAROUSEL.drop + 0.15;
    let r = 2.05;
    if (i === 2) {
      y = this.dims.triggerY;
      r = this.dims.triggerR + 0.42;
    }
    const rest = new Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
    outer.position.copy(rest);
    outer.scale.setScalar(SENSOR_SCALE);
    outer.lookAt(0, y, 0);
    this.group.add(outer);
    return { outer, inner, meshes, disc, high, low, base, rest, tip: parts.tip, focus: 0, drift: i === 2 ? 0.3 : 1, geometries };
  }

  private get set() {
    return this.highTier ? this.high : this.low;
  }

  attach(scene: Scene) {
    scene.add(this.group);
    if (this.env) scene.environment = this.env.texture;
    scene.fog = this.fog;
  }

  /** Swap material variants (both are compiled up front, so this never hitches). */
  setHighTier(high: boolean) {
    this.highTier = high;
    this.crank.material = this.set.metal;
    for (const s of this.sensors) {
      for (const { mesh, slot } of s.meshes) mesh.material = high ? s.high[slot] : s.low[slot];
      if (s.disc) s.disc.material = high ? s.high.metal : s.low.metal;
    }
  }

  get isHighTier() {
    return this.highTier;
  }

  /** World position of sensor i's stream origin (its tip). */
  tipWorld(i: number, out: Vector3) {
    const s = this.sensors[i];
    return s.inner.localToWorld(out.copy(s.tip));
  }

  /**
   * `sf` is the scroll section float (Sensor Array = 1), `c` the carousel position.
   * The rig only exists near its section: it rises out of the fog floor on the way in and sinks on
   * the way out.
   */
  update(dt: number, signals: SyntheticSignals, sf: number, c: number, wide: boolean, camera: Camera) {
    const near = sf > 0.15 && sf < 1.95;
    this.group.visible = near;
    if (!near) return;
    this.spin.rotation.y = signals.crankAngle;
    const enter = Math.min(1, Math.max(0, (sf - 0.15) / 0.85));
    const exit = Math.min(1, Math.max(0, sf - 1));
    const e1 = 1 - enter;
    this.group.position.y = -14 * e1 * e1 * e1 - 16 * exit * exit;

    const inSection = Math.max(0, 1 - Math.abs(sf - 1) * 2);
    const k = 1 - Math.exp(-dt * 5);
    let rimSensor = -1;
    let rimAmt = 0;
    for (let i = 0; i < this.sensors.length; i++) {
      const s = this.sensors[i];
      const goal = Math.max(0, 1 - Math.abs(i - c) * 1.6) * inSection;
      s.focus += (goal - s.focus) * k;
      const f = s.focus;
      if (f > rimAmt) {
        rimAmt = f;
        rimSensor = i;
      }

      // focus spot: just right of the card, in front of the crank (below the card on portrait)
      const ang = cardPose(i, wide ? i : c, wide, this.cardPos);
      if (wide) {
        const rx = Math.cos(ang);
        const rz = -Math.sin(ang);
        const ox = Math.sin(ang);
        const oz = Math.cos(ang);
        this.focusPos.set(this.cardPos.x + rx * 2.0 + ox * 0.3, this.cardPos.y - 0.22, this.cardPos.z + rz * 2.0 + oz * 0.3);
      } else {
        this.focusPos.set(this.cardPos.x, this.cardPos.y - 1.15, this.cardPos.z + 0.6);
      }
      s.outer.position.lerpVectors(s.rest, this.focusPos, f * s.drift);
      s.outer.scale.setScalar(SENSOR_SCALE * (1 + 0.4 * f));
      // tip toward the crank axis at its own height; a focused sensor turns to a 3/4 view and
      // sways gently like a product on a turntable
      this.target.set(0, s.outer.position.y, 0);
      s.outer.lookAt(this.target);
      if (f > 0.001) s.outer.rotateY(f * (-0.75 + 0.35 * Math.sin(signals.time * 0.6 + i)));
      if (s.disc) s.disc.rotation.x = signals.throttle * 1.35;

      const dim = 0.4 + 0.6 * f;
      for (const { mesh, slot } of s.meshes) setDim(mesh.material as Material, s.base[slot], dim);
      if (!this.highTier) {
        for (const { mesh } of s.meshes) {
          const u = (mesh.material as ShaderMaterial).uniforms;
          (u.uRim.value as Color).copy(this.colors[i]);
          u.uRimAmt.value = f;
        }
      }
    }

    // rim light: behind the focused sensor (seen from the camera) and a little above it
    if (rimSensor >= 0 && this.highTier) {
      const s = this.sensors[rimSensor];
      this.v.copy(s.outer.position);
      this.w.copy(this.v).sub(camera.position).normalize().multiplyScalar(0.8);
      this.rim.position.copy(this.v).add(this.w);
      this.rim.position.y += 0.45;
      this.rim.color.copy(this.colors[rimSensor]);
      this.rim.intensity = 7 * rimAmt;
    } else {
      this.rim.intensity = 0;
    }
  }

  dispose() {
    this.crank.geometry.dispose();
    disposeSet(this.high);
    disposeSet(this.low);
    this.highGrille.hex.dispose();
    this.highGrille.slots.dispose();
    for (const s of this.sensors) {
      for (const g of s.geometries) g.dispose();
      for (const slot of SLOTS) {
        s.high[slot].dispose();
        s.low[slot].dispose();
      }
    }
    this.env?.dispose();
    this.env = null;
    for (const l of this.lights) l.dispose();
    this.rim.dispose();
  }
}
