import { BoxGeometry, Color, DirectionalLight, FogExp2, Group, Mesh, MeshBasicMaterial, PMREMGenerator } from 'three';
import type { Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SyntheticSignals } from '../signals/SyntheticSignals';
import type { Palette } from '../theme';
import { buildCrankshaft } from './Crankshaft';
import type { CrankDims } from './Crankshaft';
import { disposeSet, makeHighSet, makeLowSet } from './Materials';
import type { MaterialSet } from './Materials';

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

/**
 * Everything solid in the Sensor Array: the crankshaft (and, from milestone 4, the sensor models),
 * its lights and the procedural environment (RoomEnvironment through PMREM, no HDR files).
 * The rig rises out of the fog floor as the section arrives and sinks as the page moves on.
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
  private env: WebGLRenderTarget | null = null;
  private highTier = true;
  private readonly lights: DirectionalLight[] = [];

  constructor(renderer: WebGLRenderer, palette: Palette, highTier: boolean) {
    this.high = makeHighSet();
    this.low = makeLowSet(palette);
    this.highTier = highTier;

    this.env = bakeEnvironment(renderer);

    const built = buildCrankshaft(this.set.metal, highTier ? 'high' : 'low');
    this.crank = built.mesh;
    this.dims = built.dims;
    this.spin.add(built.group);
    this.group.add(this.spin);

    // a cool key from the upper right and a violet fill from the lower left, matching the hazes
    const key = new DirectionalLight(new Color('#7FE3FF'), 1.4);
    key.position.set(4, 6, 3);
    const fill = new DirectionalLight(new Color('#9B7BFF'), 1.0);
    fill.position.set(-5, -3, 2);
    this.lights.push(key, fill);
    this.group.add(key, fill);

    this.fog = new FogExp2(palette.fog.getHex(), 0.05);
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
  }

  get isHighTier() {
    return this.highTier;
  }

  /**
   * `sf` is the scroll section float (Sensor Array = 1). The rig only exists near its section:
   * it rises out of the fog floor on the way in and sinks on the way out.
   */
  update(signals: SyntheticSignals, sf: number) {
    const near = sf > 0.15 && sf < 1.95;
    this.group.visible = near;
    if (!near) return;
    this.spin.rotation.y = signals.crankAngle;
    const enter = Math.min(1, Math.max(0, (sf - 0.15) / 0.85));
    const exit = Math.min(1, Math.max(0, sf - 1));
    const e1 = 1 - enter;
    this.group.position.y = -14 * e1 * e1 * e1 - 16 * exit * exit;
  }

  dispose() {
    this.crank.geometry.dispose();
    disposeSet(this.high);
    disposeSet(this.low);
    this.env?.dispose();
    this.env = null;
    for (const l of this.lights) l.dispose();
  }
}
