// See-through technical-illustration car, drawn like a CAD X-ray:
//   - hidden-line transparency: the body shell writes depth only, then every line set is drawn twice,
//     crisp where it is in front of the shell and faint where the shell hides it. Rotate the car and
//     the far side, the interior and the engine bay fade and sharpen as they come into view.
//   - depth fade: lines also lose opacity with distance from the camera, so the near side leads.
//   - a fresnel skin: the shell itself is almost invisible face-on and glows softly at grazing angles.
// Line groups come from Blender (blender/build_cars.py): wire_body (design lines), wire_flow (surface
// topology), wire_section, wire_glass, interior_lines, detail_lines, tyre_*_wire/_brake and zone_* parts.
// Health zones (engine, battery, cooling, fuel, tyres) glow and pulse when they are not OK.
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
const GLASS = '#8fb6e6';
const PART = '#aaa39a';
const ZONE_OK = '#a4bba9';
const FOG = '#161514';

// [width px, opacity] passes where the line is in view, and where the body hides it
const STYLE = {
  body: { color: INK, vis: [[4, 0.07], [1.35, 0.95]], hid: [[1, 0.12]] },
  flow: { color: INK, vis: [[0.8, 0.15]], hid: [] },
  section: { color: INK, vis: [[1, 0.26]], hid: [[1, 0.05]] },
  glass: { color: GLASS, vis: [[3.5, 0.08], [1.2, 0.85]], hid: [[1, 0.14]] },
  interior: { color: '#cfc8be', vis: [[1.1, 0.72]], hid: [[1, 0.24]] },
  detail: { color: PART, vis: [[1, 0.62]], hid: [[1, 0.16]] },
  part: { color: PART, vis: [[1.1, 0.8]], hid: [[1, 0.3]] },
  zone: { color: ZONE_OK, vis: [[1.1, 0.7]], hid: [[1, 0.36]] },
};
const badStyle = (c) => ({ color: c, vis: [[5, 0.25], [1.7, 1]], hid: [[5, 0.2], [1.5, 0.9]] });

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

function groupOf(o, zone) {
  if (under(o, 'wire_body')) return 'body';
  if (under(o, 'wire_flow')) return 'flow';
  if (under(o, 'wire_section')) return 'section';
  if (under(o, 'wire_glass')) return 'glass';
  if (under(o, 'interior')) return 'interior';
  if (zone) return zone.startsWith('tyre') ? 'part' : 'zone';
  return 'detail';
}

/** Linear fog, but fading alpha instead of tinting: lines dissolve into whatever is behind the canvas. */
function fadeWithDepth(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        gl_FragColor.a *= 1.0 - 0.8 * fogFactor;
      #endif`);
  };
  return material;
}

function lineMat(color, width, opacity, hidden) {
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, worldUnits: false, fog: true });
  if (hidden) m.depthFunc = THREE.GreaterDepth;
  return fadeWithDepth(m);
}

const SKIN_VS = `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const SKIN_FS = `
  uniform vec3 color; uniform float base; uniform float rim;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
    gl_FragColor = vec4(color, base + rim * f);
  }`;
const skin = (color, base, rim) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, base: { value: base }, rim: { value: rim } },
  vertexShader: SKIN_VS, fragmentShader: SKIN_FS, transparent: true, depthWrite: false,
});

const positionsOf = (geo) => (geo.index ? geo.toNonIndexed() : geo).attributes.position.array;

function styled(scene, zones, opts) {
  const root = scene.clone(true);
  const pulsing = [];
  const centers = {};
  const box = new THREE.Box3();
  const jobs = [];                                      // [object, positions, style, pulse]
  const extra = [];                                     // [mesh, skin mesh] attached after traversal
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const zone = zoneOf(o);
    const status = zone ? zones?.[zone] || 'ok' : null;
    const bad = !!status && status !== 'ok';
    const sc = STATUS_HEX[status] || STATUS_HEX.ok;
    const style = bad ? badStyle(sc) : STYLE[groupOf(o, zone)];

    if (o.isLine) {
      o.visible = false;
      jobs.push([o, positionsOf(o.geometry), style, bad]);
      return;
    }
    if (!o.isMesh) return;
    const mat = (o.material && o.material.name) || '';
    if (zone && (mat === 'Zone' || mat === 'Tyre')) {
      box.setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      centers[zone] = mat === 'Tyre' || !centers[zone] ? c : centers[zone].lerp(c, 0.5);
    }
    if (under(o, 'body')) {
      if (mat === 'Glass') {                            // see-through: never hides what is behind it
        o.material = skin(GLASS, 0.012, 0.16);
        o.renderOrder = 1;
      } else {                                          // the shell: depth for hidden lines, plus a fresnel skin
        o.material = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
        o.renderOrder = -1;
        const sk = new THREE.Mesh(o.geometry, skin('#d9d2c8', 0.008, 0.13));
        sk.renderOrder = 1;
        extra.push([o, sk]);
      }
      return;
    }
    if (mat === 'Zone') {
      if (opts.hideZones) { o.visible = false; return; }
      o.material = new THREE.MeshBasicMaterial({ color: sc, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, visible: bad });
      if (bad) pulsing.push(o.material);
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 25)), style, bad]);
    } else if (mat === 'Tyre') {
      if (bad) {
        o.material = new THREE.MeshBasicMaterial({ color: sc, transparent: true, opacity: 0.16, depthWrite: false, depthTest: false });
        pulsing.push(o.material);
      } else o.visible = false;
    } else if (mat === 'LightFront' || mat === 'LightRear') {
      const col = mat === 'LightFront' ? '#eef3ff' : '#ff3b2f';
      o.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 });
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 30)), { color: col, vis: [[3, 0.25], [1, 0.9]], hid: [[1, 0.2]] }, false]);
    } else {                                            // mirrors, handles, grille, rails, silencer: outlines only
      o.material = new THREE.MeshBasicMaterial({ visible: false });
      jobs.push([o, positionsOf(new THREE.EdgesGeometry(o.geometry, 30)), STYLE.detail, false]);
    }
  });
  extra.forEach(([o, sk]) => o.add(sk));
  jobs.forEach(([o, pos, style, pulse]) => {
    const geo = new LineSegmentsGeometry().setPositions(pos);
    for (const [passes, hidden] of [[style.vis, false], [style.hid, true]]) {
      for (const [width, opacity] of passes) {
        const l = new LineSegments2(geo, lineMat(style.color, width, opacity, hidden));
        l.renderOrder = hidden ? 2 : 3;
        if (o.isMesh) o.add(l);
        else { l.position.copy(o.position); l.quaternion.copy(o.quaternion); l.scale.copy(o.scale); o.parent.add(l); }
        if (pulse) { l.material.userData.base = opacity; pulsing.push(l.material); }
      }
    }
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
      if (m.isLineMaterial) m.opacity = m.userData.base * (0.45 + 0.55 * k);
      else m.opacity = 0.06 + 0.2 * k;
    });
  });
  return <primitive object={built.root} />;
}

/** Keeps the depth fade centred on the car whatever the zoom. */
function DepthFade() {
  const { scene, camera } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog(FOG, 6, 14);
    return () => { scene.fog = null; };
  }, [scene]);
  useFrame(() => {
    if (!scene.fog) return;
    const d = camera.position.distanceTo(new THREE.Vector3(0, 0.7, 0));
    scene.fog.near = d - 2.2;
    scene.fog.far = d + 4.2;
  });
  return null;
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
  // drawn before the shell writes depth, so the floor shows through the car like the rest of the X-ray
  return <points geometry={geo} renderOrder={-2}><pointsMaterial color="#3d3a35" size={0.024} sizeAttenuation fog={false} /></points>;
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
      <DepthFade />
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
        <DepthFade />
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
