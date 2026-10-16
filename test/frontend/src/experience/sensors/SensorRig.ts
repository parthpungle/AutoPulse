import { gsap } from 'gsap';
import { Box3, BoxGeometry, Color, DirectionalLight, FogExp2, Group, MathUtils, Mesh, MeshBasicMaterial, PMREMGenerator, PointLight, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Material, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SENSORS } from '../../content/sensors';
import { CAROUSEL, showcaseSpot } from '../carousel/CarouselLayout';
import type { FullscreenQuad } from '../gl/FullscreenQuad';
import type { SyntheticSignals } from '../signals/SyntheticSignals';
import type { Palette } from '../theme';
import type { Shared } from '../Uniforms';
import { ContactShadow } from './ContactShadow';
import { buildCrankshaft } from './Crankshaft';
import type { CrankDims } from './Crankshaft';
import { makeMaterial, setDim, setEnv, setPulse, setTip } from './HardwareMaterials';
import type { MatKey } from './HardwareMaterials';
import { MountRings } from './MountRings';
import { SLOTS, buildSensor } from './SensorModels';
import type { Slot } from './SensorModels';

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

interface SensorInst {
  outer: Group;
  inner: Group;
  /** Each mesh (one per part) with its two tier variants (per-sensor materials sharing programs)
   *  and how far it sits from the model's centre along the sensor's axis (the exploded view). */
  meshes: { mesh: Mesh; high: Material; low: Material; axial: number }[];
  disc: Mesh | null;
  /** On the engine: position and orientation (tip toward the crank axis), in rig space. */
  rest: Vector3;
  mountQuat: Quaternion;
  tip: Vector3;
  /** The part the tip belongs to (it carries the tip along in the exploded view). */
  tipPart: Mesh;
  /** Free end of the cable and, for the throttle and the clamp, the axis the flow passes through. */
  cableEnd: Vector3;
  through: Vector3[] | null;
  /** 0 on its mount .. 1 at the showcase spot (tweened on card change). */
  fly: { value: number };
  /** Model centre (outer space, scale 1), its bounding radius, and the extent fitted to the showcase height. */
  center: Vector3;
  radius: number;
  fit: number;
  /** Turntable angle while showcased. */
  spin: number;
  geometries: BufferGeometry[];
}

/** Sensors on the engine are small; the showcased one is scaled to the spot's height. */
const MOUNT_SCALE = 0.9;
const SLOT_MAT: Record<Slot, MatKey> = { steel: 'steel', darkSteel: 'darkSteel', brass: 'brass', blackPlastic: 'blackPlastic', rubber: 'rubber', ceramic: 'ceramic', grille: 'steel' };
const FLY_TIME = 0.9;
const SPIN_SPEED = MathUtils.degToRad(8);
const CURSOR_TILT = MathUtils.degToRad(6);
/** Exploded view: parts move apart along the sensor's axis by this much of their offset. */
const EXPLODE = 0.8;
/** The showcase pose looks slightly down onto the model. */
const PITCH = 0.3;
/** Tunables for the showcase lighting (also in the ?debug panel). Offsets are in camera terms
 *  (right, up, toward the viewer) from the showcase spot. */
export const RIG_LIGHTS = {
  crankDim: 0.55,
  /** The crank's reflections dim with it (metal brightness is mostly the environment). */
  crankEnv: 0.45,
  key: [-3, 4, 2.5],
  fill: [4, -1, 2],
  rim: [1.1, 1.1, -1.3],
  rimIntensity: 25,
  /** The showcased model's reflections are lifted so dark plastics still read. */
  showEnv: 1.6,
};
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
/** Builder space is Y-up; this stands a model upright in camera space (see `inner`). */
const UPRIGHT = new Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2);

/**
 * Everything solid in the Sensor Array: the crankshaft, the eight sensor models, their lights,
 * mount rings, a contact shadow and the procedural environment (RoomEnvironment through PMREM, no
 * HDR files). The rig rises out of the fog floor as the section arrives and sinks as the page
 * moves on.
 *
 * Showcase: the active card's sensor flies out of its mount to a spot in camera space (left of
 * centre, ~33% of the viewport tall) along a quadratic Bézier pulled toward the camera, 900 ms
 * power3.inOut, while the previous one flies home. There it turns slowly (8°/s), tilts toward the
 * cursor and is lit by a 3-point rig placed around the spot: a warm key from the upper left, a
 * cool low fill from the right and a rim in the sensor's colour from behind and above. The crank
 * stays in the background, dimmed to 55%; every other sensor waits on its mount, small and dim,
 * marked by a pulsing ring in its colour.
 */
export class SensorRig {
  readonly group = new Group();
  /** Rotates with the crank angle (crank, trigger wheel). */
  readonly spin = new Group();
  readonly dims: CrankDims;
  readonly crankBody: Mesh;
  readonly crankBearings: Mesh;
  readonly fog: FogExp2;
  readonly sensors: SensorInst[] = [];
  readonly rings: MountRings;
  readonly shadow = new ContactShadow();
  /** The showcase lighting tunables (shared with the debug panel). */
  readonly lightParams = RIG_LIGHTS;
  /** Crank materials, [high, low] for the body and the polished bearings. */
  private readonly crankMats: { body: [Material, Material]; bearings: [Material, Material] };
  readonly key = new DirectionalLight(new Color('#FFE9D6'), 2.6);
  readonly fill = new DirectionalLight(new Color('#8DB4FF'), 0.7);
  readonly rim = new PointLight(0xffffff, 0, 4, 2);
  private env: WebGLRenderTarget | null = null;
  private highTier = true;
  private active = -1;
  /** 0..1 exploded view of the showcased sensor (the detail view). */
  readonly exploded = { value: 0 };
  private tiltX = 0;
  private tiltY = 0;
  private readonly colors = SENSORS.map((s) => new Color(s.color));
  private readonly spot = new Vector3();
  private readonly spotLocal = new Vector3();
  private readonly camLocal = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly p2 = new Vector3();
  private readonly ctrl = new Vector3();
  private readonly v = new Vector3();
  private readonly showQ = new Quaternion();
  private readonly q = new Quaternion();

  constructor(renderer: WebGLRenderer, palette: Palette, highTier: boolean, shared: Shared) {
    this.highTier = highTier;
    this.env = bakeEnvironment(renderer);

    this.crankMats = {
      body: [makeMaterial('steel', true), makeMaterial('steel', false)],
      bearings: [makeMaterial('polished', true), makeMaterial('polished', false)],
    };
    const t = highTier ? 0 : 1;
    const built = buildCrankshaft(this.crankMats.body[t], this.crankMats.bearings[t], highTier ? 'high' : 'low');
    this.crankBody = built.body;
    this.crankBearings = built.bearings;
    this.dims = built.dims;
    this.spin.add(built.group);
    this.group.add(this.spin);

    for (let i = 0; i < SENSORS.length; i++) this.sensors.push(this.buildSensor(i, highTier));

    // mount rings: around each mount point, just inside the sensor's tip, facing out from the axis
    const mounts: Vector3[] = [];
    const normals: Vector3[] = [];
    for (const s of this.sensors) {
      const n = new Vector3(s.rest.x, 0, s.rest.z).normalize();
      normals.push(n);
      mounts.push(s.rest.clone().addScaledVector(n, -0.42));
    }
    this.rings = new MountRings(mounts, normals, this.colors, shared);
    this.group.add(this.rings.mesh);

    // the 3-point rig (positions follow the showcase spot every frame); the light count never
    // changes, so no program ever recompiles
    this.group.add(this.key, this.key.target, this.fill, this.fill.target, this.rim);

    this.fog = new FogExp2(palette.fog.getHex(), 0.05);
  }

  private buildSensor(i: number, highTier: boolean): SensorInst {
    const parts = buildSensor(i, highTier ? 'high' : 'low');
    const outer = new Group();
    const inner = new Group();
    inner.rotation.x = -Math.PI / 2; // builder space has the tip at -Y; this turns it to +Z
    outer.add(inner);
    const meshes: { mesh: Mesh; high: Material; low: Material; axial: number }[] = [];
    const geometries: BufferGeometry[] = [];
    const box = new Box3();
    const add = (g: BufferGeometry, key: MatKey, cut: 'none' | 'hex' | 'slots') => {
      const hi = makeMaterial(key, true, cut);
      const lo = makeMaterial(key, false);
      const mesh = new Mesh(g, highTier ? hi : lo);
      inner.add(mesh);
      g.computeBoundingBox();
      meshes.push({ mesh, high: hi, low: lo, axial: (g.boundingBox!.min.y + g.boundingBox!.max.y) / 2 });
      geometries.push(g);
      box.union(g.boundingBox!);
      return mesh;
    };
    for (const slot of SLOTS) {
      const g = parts.geo[slot];
      if (g) add(g, SLOT_MAT[slot], slot === 'grille' ? parts.grilleCut : 'none');
    }
    const disc = parts.disc ? add(parts.disc, 'steel', 'none') : null;

    // fitting: the model stands upright in the showcase, so its builder-space height counts most
    const ext = box.getSize(new Vector3());
    const fit = Math.max(ext.y, 0.85 * Math.max(ext.x, ext.z));
    const midY = (box.min.y + box.max.y) / 2;
    for (const m of meshes) m.axial -= midY;
    // the part nearest the tip
    let tipPart = meshes[0].mesh;
    let best = Infinity;
    for (const m of meshes) {
      const d = m.mesh.geometry.boundingBox!.distanceToPoint(parts.tip);
      if (d < best) {
        best = d;
        tipPart = m.mesh;
      }
    }
    inner.updateMatrix();
    const center = box.getCenter(new Vector3()).applyMatrix4(inner.matrix);
    const radius = ext.length() / 2;

    // rest: on the helix around the crank, tip toward the axis. The crank position sensor sits
    // at the 60-2 trigger wheel, tip facing the teeth.
    const a = i * CAROUSEL.step + 0.5;
    let y = CAROUSEL.top - i * CAROUSEL.drop + 0.15;
    let r = 2.05;
    if (i === 2) {
      y = this.dims.triggerY;
      r = this.dims.triggerR + 0.42;
    }
    const rest = new Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
    outer.position.copy(rest);
    outer.scale.setScalar(MOUNT_SCALE);
    outer.lookAt(0, y, 0);
    const mountQuat = outer.quaternion.clone();
    this.group.add(outer);
    // the arrival glow sits on the tip (on the bore or the jaw for flows that pass through)
    const glow = parts.through ? new Vector3() : parts.tip;
    for (const m of meshes) {
      setTip(m.high, glow, parts.through ? 0.32 : 0.24);
      setTip(m.low, glow, 0);
    }
    return { outer, inner, meshes, disc, rest, mountQuat, tip: parts.tip, tipPart, cableEnd: parts.cableEnd, through: parts.through ?? null, fly: { value: 0 }, center, radius, fit, spin: -0.7, geometries };
  }

  attach(scene: Scene) {
    scene.add(this.group, this.shadow.mesh);
    if (this.env) scene.environment = this.env.texture;
    scene.fog = this.fog;
  }

  /** Swap material variants (both are compiled up front, so this never hitches). */
  setHighTier(high: boolean) {
    this.highTier = high;
    const t = high ? 0 : 1;
    this.crankBody.material = this.crankMats.body[t];
    this.crankBearings.material = this.crankMats.bearings[t];
    for (const s of this.sensors) for (const m of s.meshes) m.mesh.material = high ? m.high : m.low;
  }

  get isHighTier() {
    return this.highTier;
  }

  /** The showcased sensor (-1 before the first frame in the section). */
  get showcased() {
    return this.active;
  }

  /** Sensor i's tip in builder space, following its part in the exploded view. */
  tipLocal(i: number, out: Vector3) {
    const s = this.sensors[i];
    return out.copy(s.tip).add(s.tipPart.position);
  }

  /** World position of sensor i's tip (where its flow arrives). */
  tipWorld(i: number, out: Vector3) {
    return this.sensors[i].inner.localToWorld(this.tipLocal(i, out));
  }

  /** Take the showcased sensor apart along its axis (detail open) or put it back together. */
  setExploded(on: boolean, reduced: boolean) {
    gsap.to(this.exploded, { value: on && !reduced ? 1 : 0, duration: 0.7, ease: 'power3.inOut', overwrite: true });
  }

  /** Fly sensor i out to the showcase and send the others home. */
  private setActive(i: number, reduced: boolean) {
    const prev = this.active;
    this.active = i;
    for (let j = 0; j < this.sensors.length; j++) {
      const s = this.sensors[j];
      const goal = j === i ? 1 : 0;
      if (s.fly.value !== goal) gsap.to(s.fly, { value: goal, duration: reduced ? 0.6 : FLY_TIME, ease: reduced ? 'none' : 'power3.inOut', overwrite: true });
    }
    // only the showcased model casts the silhouette shadow
    if (prev >= 0) for (const m of this.sensors[prev].meshes) m.mesh.layers.disable(ContactShadow.LAYER);
    for (const m of this.sensors[i].meshes) m.mesh.layers.enable(ContactShadow.LAYER);
  }

  /**
   * `sf` is the scroll section float (Sensor Array = 1), `c` the carousel position and `active`
   * its card; `detail` 0..1 is the card expansion (the spot moves into the visible left area);
   * `px, py` (-1..1) is the pointer; `arrival` 0..1 is the active flow reaching the showcased
   * sensor's tip (it glows in its colour). Run after the camera has moved for this frame.
   */
  update(dt: number, signals: SyntheticSignals, sf: number, active: number, wide: boolean, camera: PerspectiveCamera, detail: number, reduced: boolean, px: number, py: number, arrival: number) {
    const near = sf > 0.15 && sf < 1.95;
    this.group.visible = near;
    this.shadow.mesh.visible = near;
    if (!near) return;
    if (active !== this.active) this.setActive(active, reduced);
    this.spin.rotation.y = signals.crankAngle;
    const enter = Math.min(1, Math.max(0, (sf - 0.15) / 0.85));
    const exit = Math.min(1, Math.max(0, sf - 1));
    const e1 = 1 - enter;
    this.group.position.y = -14 * e1 * e1 * e1 - 16 * exit * exit;
    this.group.updateMatrixWorld();

    const inSection = Math.max(0, 1 - Math.abs(sf - 1) * 2);
    const crankDim = MathUtils.lerp(1, RIG_LIGHTS.crankDim, inSection);
    const crankEnv = MathUtils.lerp(1, RIG_LIGHTS.crankEnv, inSection);
    for (const m of [this.crankBody.material, this.crankBearings.material] as Material[]) {
      setDim(m, crankDim);
      setEnv(m, crankEnv);
    }

    // the spot, in rig space (the rig only ever translates)
    const targetH = showcaseSpot(camera, wide, detail, this.spot);
    this.spotLocal.copy(this.spot).sub(this.group.position);
    this.camLocal.copy(camera.position).sub(this.group.position);
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]);
    this.up.set(e[4], e[5], e[6]);
    this.back.set(e[8], e[9], e[10]);
    const k = 1 - Math.exp(-dt * 4);
    this.tiltX += (-py * CURSOR_TILT - this.tiltX) * k;
    this.tiltY += (px * CURSOR_TILT - this.tiltY) * k;

    let shown = 0;
    for (let i = 0; i < this.sensors.length; i++) {
      const s = this.sensors[i];
      let t = s.fly.value * inSection;
      let fade = 1;
      if (reduced) {
        // no arc: dim out, swap places, dim back in
        fade = Math.abs(2 * t - 1);
        t = t < 0.5 ? 0 : 1;
      }
      if (i === active) shown = t;
      if (s.disc) s.disc.rotation.x = signals.throttle * 1.35;
      if (t <= 0) {
        s.outer.position.copy(s.rest);
        s.outer.quaternion.copy(s.mountQuat);
        s.outer.scale.setScalar(MOUNT_SCALE);
      } else {
        if (!reduced) s.spin += dt * SPIN_SPEED;
        // exploded, the model is taller: shrink it so it still fits the spot
        const ex = i === active ? this.exploded.value : 0;
        const sc = (targetH / s.fit) / (1 + 0.55 * ex);
        // camera-facing, upright, pitched toward the viewer, turning on its own axis, plus the cursor
        this.showQ.copy(camera.quaternion);
        this.showQ.multiply(this.q.setFromAxisAngle(Y_AXIS, this.tiltY));
        this.showQ.multiply(this.q.setFromAxisAngle(X_AXIS, PITCH + this.tiltX));
        this.showQ.multiply(this.q.setFromAxisAngle(Y_AXIS, s.spin));
        this.showQ.multiply(UPRIGHT);
        // end point: the model's centre on the spot
        this.p2.copy(s.center).applyQuaternion(this.showQ).multiplyScalar(-sc).add(this.spotLocal);
        // the path bows toward the camera
        this.ctrl.addVectors(s.rest, this.p2).multiplyScalar(0.5);
        this.v.subVectors(this.camLocal, this.ctrl).normalize();
        this.ctrl.addScaledVector(this.v, 1.4);
        const u = 1 - t;
        s.outer.position.copy(s.rest).multiplyScalar(u * u).addScaledVector(this.ctrl, 2 * u * t).addScaledVector(this.p2, t * t);
        s.outer.quaternion.copy(s.mountQuat).slerp(this.showQ, t);
        s.outer.scale.setScalar(MathUtils.lerp(MOUNT_SCALE, sc, t));
      }
      const ex = i === active ? this.exploded.value * t : 0;
      for (const m of s.meshes) m.mesh.position.y = m.axial * EXPLODE * ex;
      const dim = MathUtils.lerp(0.45, 1, t) * fade;
      const env = MathUtils.lerp(1, RIG_LIGHTS.showEnv, t);
      for (const m of s.meshes) {
        setDim(m.mesh.material as Material, dim);
        setEnv(m.mesh.material as Material, env);
        // the tip glows as the flow arrives; the cheap path has no lights, so it also fakes the rim
        const hear = i === active ? arrival * t : 0;
        setPulse(m.mesh.material as Material, this.highTier ? hear * 1.4 : t * 0.8 + hear * 0.5, this.colors[i]);
      }
      this.rings.alpha[i] = inSection * (0.7 - 0.35 * t);
    }

    // 3-point rig around the spot, in camera terms: key upper left and in front, fill low right,
    // rim behind and above in the sensor's colour
    const L = RIG_LIGHTS;
    this.place(this.key.position, L.key);
    this.place(this.fill.position, L.fill);
    this.key.target.position.copy(this.spotLocal);
    this.fill.target.position.copy(this.spotLocal);
    const a = Math.max(0, active);
    this.place(this.rim.position, L.rim);
    this.rim.color.copy(this.colors[a]);
    this.rim.intensity = this.highTier ? L.rimIntensity * shown : 0;

    // contact shadow under the showcased model
    const s = this.sensors[a];
    const sc = targetH / s.fit / (1 + 0.55 * this.exploded.value);
    this.shadow.place(this.spot, s.radius * sc * (0.8 + 0.4 * this.exploded.value), camera, 0.85 * shown, this.highTier);
  }

  /** The spot plus an offset in camera terms (right, up, toward the viewer). */
  private place(out: Vector3, o: number[]) {
    return out.copy(this.spotLocal).addScaledVector(this.right, o[0]).addScaledVector(this.up, o[1]).addScaledVector(this.back, o[2]);
  }

  /** Tier >= 2: the shadow's blurred footprint (call before the main render). */
  renderShadow(renderer: WebGLRenderer, quad: FullscreenQuad, scene: Scene) {
    if (this.group.visible && this.highTier) this.shadow.renderSilhouette(renderer, quad, scene);
  }

  dispose() {
    this.crankBody.geometry.dispose();
    this.crankBearings.geometry.dispose();
    for (const m of [...this.crankMats.body, ...this.crankMats.bearings]) m.dispose();
    for (const s of this.sensors) {
      gsap.killTweensOf(s.fly);
      gsap.killTweensOf(this.exploded);
      for (const g of s.geometries) g.dispose();
      for (const m of s.meshes) {
        m.high.dispose();
        m.low.dispose();
      }
    }
    this.env?.dispose();
    this.env = null;
    this.key.dispose();
    this.fill.dispose();
    this.rim.dispose();
    this.rings.dispose();
    this.shadow.dispose();
  }
}
