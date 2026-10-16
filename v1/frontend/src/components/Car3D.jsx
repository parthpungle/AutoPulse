// See-through wireframe car. Geometry and contour lines come from Blender (blender/build_cars.py):
//   wire_body  - cross-section rings + front-to-back lines of the lofted body (CAD-style contour mesh)
//   wire_glass - window outlines; tyre_*_wire - tyre tori; small parts are outlined here with edge lines
// Components inside (engine, battery, radiator, fuel tank, tyres) are visible through the body:
// faint outlines when healthy, glowing and pulsing when not.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export const STATUS_HEX = { ok: '#0ca30c', info: '#c3c2b7', warning: '#fab219', critical: '#d03b3b' };
const TYPES = ['hatchback', 'sedan', 'suv', 'pickup', 'coupe'];
TYPES.forEach((t) => useGLTF.preload(`/models/${t}.glb`));

const INK = '#ddd7cf';
const INK_SOFT = '#9d978f';
const GLASS = '#8fb6e6';

function zoneOf(obj) {
  for (let o = obj; o; o = o.parent) {
    const n = o.name || '';
    if (n.startsWith('zone_engine')) return 'engine';
    if (n.startsWith('zone_battery')) return 'battery';
    if (n.startsWith('zone_cooling')) return 'cooling';
    if (n.startsWith('zone_fuel')) return 'fuel';
    const m = n.match(/^tyre_(fl|fr|rl|rr)/);
    if (m) return `tyre_${m[1]}`;
  }
  return null;
}
const under = (obj, prefix) => { for (let o = obj; o; o = o.parent) if ((o.name || '').startsWith(prefix)) return true; return false; };

function lines(geo, color, opacity) {
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

function styled(scene, zones, bright, hideZones = false) {
  const root = scene.clone(true);
  const pulsing = [];
  const centers = {};
  const box = new THREE.Box3();
  const add = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const zone = zoneOf(o);
    const status = zone ? zones?.[zone] || 'ok' : null;
    const bad = status && status !== 'ok';
    const sc = STATUS_HEX[status] || STATUS_HEX.ok;

    if (o.isLine) {                                    // designed contour lines from Blender
      const n = o.name || '';
      let color = INK, opacity = bright ? 0.62 : 0.5;
      if (n.startsWith('wire_glass') || under(o, 'wire_glass')) { color = GLASS; opacity = 0.75; }
      if (zone) { color = bad ? sc : INK_SOFT; opacity = bad ? 1 : 0.55; }
      o.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      if (bad) pulsing.push(o.material);
      return;
    }
    if (!o.isMesh) return;
    const mat = (o.material && o.material.name) || '';
    if (zone && mat === 'Zone') {
      box.setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      centers[zone] = centers[zone] ? centers[zone].lerp(c, 0.5) : c;
    }
    if (zone && zone.startsWith('tyre') && mat === 'Tyre') {
      box.setFromObject(o);
      centers[zone] = box.getCenter(new THREE.Vector3());
    }

    if (mat === 'Zone' && hideZones) {
      o.visible = false;
    } else if (mat === 'Zone') {
      const col = new THREE.Color(sc);
      o.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: bad ? 0.32 : 0.06, depthWrite: false });
      add.push([o, col, bad ? 1 : 0.5, 20]);
      if (bad) pulsing.push(o.material);
    } else if (mat === 'LightFront' || mat === 'LightRear') {
      o.material = new THREE.MeshBasicMaterial({ color: mat === 'LightFront' ? '#eef3ff' : '#ff3b2f' });
    } else if (under(o, 'body')) {                     // the shell: a whisper of fill so it reads as a volume
      o.material = new THREE.MeshBasicMaterial({ color: '#cbc5bc', transparent: true, opacity: mat === 'Glass' ? 0.02 : 0.03,
        depthWrite: false, side: THREE.DoubleSide });
    } else if (mat === 'Tyre') {
      o.material = new THREE.MeshBasicMaterial({ color: bad ? sc : '#000000', transparent: true, opacity: bad ? 0.18 : 0.25,
        depthWrite: false });
      if (bad) pulsing.push(o.material);
    } else {                                           // mirrors, handles, grille, rails, rims, spokes: outlines only
      const tint = zone && bad ? sc : INK_SOFT;
      o.material = new THREE.MeshBasicMaterial({ visible: false });
      add.push([o, new THREE.Color(tint), zone && bad ? 0.9 : 0.55, 30]);
    }
  });
  add.forEach(([o, color, opacity, angle]) => o.add(lines(new THREE.EdgesGeometry(o.geometry, angle), color, opacity)));
  return { root, pulsing, centers };
}

function Model({ type, zones, bright, onCenters, hideZones = false }) {
  const { scene } = useGLTF(`/models/${type}.glb`);
  const key = JSON.stringify(zones || {});
  const built = useMemo(() => styled(scene, zones, bright, hideZones), [scene, key, bright, hideZones]); // eslint-disable-line
  useEffect(() => { onCenters?.(built.centers); }, [built, onCenters]);
  useFrame(({ clock }) => {
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
    built.pulsing.forEach((m) => { m.opacity = m.isLineBasicMaterial ? 0.45 + 0.55 * k : 0.12 + 0.3 * k; });
  });
  return <primitive object={built.root} />;
}

function Rig({ focusPoint, autoRotate }) {
  const controls = useThree((s) => s.controls);
  const target = useRef(new THREE.Vector3(0, 0.7, 0));
  useFrame(() => {
    if (!controls) return;
    target.current.lerp(focusPoint || new THREE.Vector3(0, 0.7, 0), 0.06);
    controls.target.copy(target.current);
    controls.autoRotate = autoRotate && !focusPoint;
    controls.update();
  });
  return null;
}

function DotFloor() {
  const geo = useMemo(() => {
    const pts = [];
    for (let x = -6; x <= 6.01; x += 0.28) for (let z = -4; z <= 4.01; z += 0.28) {
      if (x * x / 36 + z * z / 16 < 1) pts.push(x, 0.002, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return <points geometry={geo}><pointsMaterial color="#4a4640" size={0.026} sizeAttenuation /></points>;
}

/** Small static wireframe preview for the car picker: renders once, no controls. */
export function CarThumb({ type }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [4.4, 1.7, 5.0], fov: 30 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.62, 0)} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
      <Suspense fallback={null}><Model type={type} zones={{}} bright hideZones /></Suspense>
    </Canvas>
  );
}

export default function Car3D({ type, mode = 'showroom', zones, focus = null, autoRotate = true, height = '100%', distance = 1 }) {
  const centers = useRef({});
  const focusPoint = focus && centers.current[focus] ? centers.current[focus] : null;
  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <Canvas dpr={[1, 2]} camera={{ position: [5.8 * distance, 2.4 * distance, 6.6 * distance], fov: 30 }}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} style={{ background: 'transparent' }}>
        <Suspense fallback={null}>
          <Model type={type} zones={zones} bright={mode === 'showroom'} onCenters={(c) => { centers.current = c; }} />
        </Suspense>
        <DotFloor />
        <OrbitControls makeDefault enablePan={false} minDistance={4.5} maxDistance={13}
          maxPolarAngle={1.48} autoRotateSpeed={0.7} enableDamping />
        <Rig focusPoint={focusPoint} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
