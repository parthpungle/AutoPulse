// See-through feature-line car. Lines come from Blender (blender/build_cars.py):
//   wire_body     primary feature lines: sill & wheel arches, belt/shoulder, roof edges, spine, door cuts, shut lines
//   wire_section  a few faint cross-sections at the axles and pillars
//   wire_glass    window outlines           tyre_*_wire  tyre circles, rim and line spokes
// Rendered with real line weights (glow pass + crisp core). Components inside the body
// (engine, battery, radiator, fuel tank, tyres) are outlined; faults glow and pulse.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export const STATUS_HEX = { ok: '#0ca30c', info: '#c3c2b7', warning: '#fab219', critical: '#d03b3b' };
const TYPES = ['hatchback', 'sedan', 'suv', 'pickup', 'coupe'];
TYPES.forEach((t) => useGLTF.preload(`/models/${t}.glb`));

const INK = '#efe9e1';
const SECTION = '#8f8a83';
const GLASS = '#8fb6e6';
const PART = '#a8a29a';

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

function fat(positions, color, width, opacity) {
  const g = new LineSegmentsGeometry().setPositions(positions);
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, worldUnits: false });
  return new LineSegments2(g, m);
}
const positionsOf = (geo) => (geo.index ? geo.toNonIndexed() : geo).attributes.position.array;

function styled(scene, zones, opts) {
  const root = scene.clone(true);
  const pulsing = [];
  const centers = {};
  const box = new THREE.Box3();
  const jobs = [];                                     // [source object, positions, [[color, width, opacity], ...], pulse?]
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const zone = zoneOf(o);
    const status = zone ? zones?.[zone] || 'ok' : null;
    const bad = !!status && status !== 'ok';
    const sc = STATUS_HEX[status] || STATUS_HEX.ok;
    const n = o.name || '';

    if (o.isLine) {
      o.visible = false;
      const pos = positionsOf(o.geometry);
      if (n.startsWith('wire_body') || under(o, 'wire_body')) jobs.push([o, pos, [[INK, 4, 0.10], [INK, 1.35, 0.92]]]);
      else if (n.startsWith('wire_section') || under(o, 'wire_section')) jobs.push([o, pos, [[SECTION, 1, 0.28]]]);
      else if (n.startsWith('wire_glass') || under(o, 'wire_glass')) jobs.push([o, pos, [[GLASS, 3.5, 0.10], [GLASS, 1.2, 0.85]]]);
      else if (zone) jobs.push([o, pos, bad ? [[sc, 5, 0.25], [sc, 1.6, 1]] : [[PART, 1.1, 0.75]], bad]);
      return;
    }
    if (!o.isMesh) return;
    const mat = (o.material && o.material.name) || '';
    if (zone && (mat === 'Zone' || mat === 'Tyre')) {
      box.setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      centers[zone] = mat === 'Tyre' || !centers[zone] ? c : centers[zone].lerp(c, 0.5);
    }
    if (mat === 'Zone') {
      if (opts.hideZones) { o.visible = false; return; }
      o.material = new THREE.MeshBasicMaterial({ color: sc, transparent: true, opacity: bad ? 0.22 : 0.035, depthWrite: false });
      if (bad) pulsing.push(o.material);
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 20)), bad ? [[sc, 5, 0.22], [sc, 1.6, 1]] : [[sc, 1.1, 0.5]], bad]);
    } else if (mat === 'LightFront' || mat === 'LightRear') {
      const col = mat === 'LightFront' ? '#eef3ff' : '#ff3b2f';
      o.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 30)), [[col, 3, 0.25]]]);
    } else if (under(o, 'body')) {                     // the shell: a whisper of fill so it reads as a volume
      o.material = new THREE.MeshBasicMaterial({ color: '#cbc5bc', transparent: true, opacity: 0.022, depthWrite: false, side: THREE.DoubleSide });
    } else if (zone && zone.startsWith('tyre')) {      // rims, spokes, discs, tyre solids: drawn by the tyre wire instead
      if (mat === 'Tyre' && bad) {
        o.material = new THREE.MeshBasicMaterial({ color: sc, transparent: true, opacity: 0.16, depthWrite: false });
        pulsing.push(o.material);
      } else o.visible = false;
    } else {                                           // mirrors, handles, grille, rails, spoiler, bed: thin outlines
      o.material = new THREE.MeshBasicMaterial({ visible: false });
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 30)), [[PART, 1, 0.5]]]);
    }
  });
  jobs.forEach(([o, pos, passes, pulse]) => {
    passes.forEach(([color, width, opacity]) => {
      const l = fat(pos, color, width, opacity);
      l.renderOrder = 2;
      if (o.isMesh) o.add(l);
      else { l.position.copy(o.position); l.quaternion.copy(o.quaternion); l.scale.copy(o.scale); o.parent.add(l); }
      if (pulse) pulsing.push(l.material);
    });
  });
  return { root, pulsing, centers };
}

function Model({ type, zones, onCenters, hideZones = false }) {
  const { scene } = useGLTF(`/models/${type}.glb`);
  const key = JSON.stringify(zones || {});
  const built = useMemo(() => styled(scene, zones, { hideZones }), [scene, key, hideZones]); // eslint-disable-line
  useEffect(() => { onCenters?.(built.centers); }, [built, onCenters]);
  useFrame(({ clock }) => {
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
    built.pulsing.forEach((m) => {
      if (m.isLineMaterial) m.opacity = m.linewidth > 3 ? 0.1 + 0.3 * k : 0.55 + 0.45 * k;
      else m.opacity = 0.08 + 0.22 * k;
    });
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

/** Pull the camera back on narrow canvases so the whole car always fits. */
function Fit({ distance }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const len = Math.hypot(5.8, 2.3, 6.6) * distance * Math.max(1, (1.3 / aspect) ** 0.85);  // a 3/4 view is narrower than a side view
    const target = controls ? controls.target : new THREE.Vector3(0, 0.7, 0);
    camera.position.sub(target).setLength(len).add(target);
  }, [size.width, size.height, distance, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Floor() {
  const geo = useMemo(() => {
    const pts = [];
    for (let x = -6; x <= 6.01; x += 0.3) for (let z = -4; z <= 4.01; z += 0.3) {
      if (x * x / 36 + z * z / 16 < 1) pts.push(x, 0.002, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return <points geometry={geo}><pointsMaterial color="#3d3a35" size={0.024} sizeAttenuation /></points>;
}

function Spin({ on, children }) {
  const g = useRef();
  useFrame((_, dt) => { if (on && g.current) g.current.rotation.y += dt * 0.45; });
  return <group ref={g}>{children}</group>;
}

/** Small wireframe preview (car picker dropdown). Static unless spin is set; only mounted while visible. */
export function CarThumb({ type, spin = false }) {
  return (
    <Canvas frameloop={spin ? 'always' : 'demand'} dpr={[1, 2]} camera={{ position: [4.4, 1.6, 5.0], fov: 30 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.62, 0)} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
      <Suspense fallback={null}><Spin on={spin}><Model type={type} zones={{}} hideZones /></Spin></Suspense>
    </Canvas>
  );
}

export default function Car3D({ type, zones, focus = null, autoRotate = true, height = '100%', distance = 1 }) {
  const centers = useRef({});
  const focusPoint = focus && centers.current[focus] ? centers.current[focus] : null;
  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <Canvas dpr={[1, 2]} camera={{ position: [5.8 * distance, 2.3 * distance, 6.6 * distance], fov: 30 }}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} style={{ background: 'transparent' }}>
        <Suspense fallback={null}>
          <Model type={type} zones={zones} onCenters={(c) => { centers.current = c; }} />
        </Suspense>
        <Floor />
        <Fit distance={distance} />
        <OrbitControls makeDefault enablePan={false} minDistance={4.5} maxDistance={16}
          maxPolarAngle={1.48} autoRotateSpeed={0.6} enableDamping />
        <Rig focusPoint={focusPoint} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
