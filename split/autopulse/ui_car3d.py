"""3D line-art car for the dashboard: three.js wireframe, one silhouette per body type,
with health zones (engine bay, tyres, battery, radiator, fuel tank) coloured by status."""
import json

STATUS_HEX = {"ok": "#74C79C", "info": "#7FB3E8", "warning": "#E4B667", "critical": "#F0614F"}

# side silhouettes in metres: x from rear (0) to front (L), y up; top points run rear -> front
BODIES = {
    "hatchback": {"L": 3.95, "W": 1.72, "R": 0.30, "xr": 0.70, "xf": 3.20,
                  "top": [[0, 0.45], [0.02, 1.00], [0.25, 1.45], [1.95, 1.50], [2.55, 1.05], [3.70, 0.88], [3.95, 0.62]],
                  "glass": [[0.30, 1.05], [0.45, 1.38], [1.90, 1.42], [2.38, 1.05]]},
    "sedan": {"L": 4.60, "W": 1.78, "R": 0.31, "xr": 0.95, "xf": 3.65,
              "top": [[0, 0.48], [0.05, 0.92], [0.85, 0.98], [1.45, 1.42], [2.85, 1.44], [3.40, 0.98], [4.45, 0.86], [4.60, 0.60]],
              "glass": [[1.00, 1.00], [1.55, 1.36], [2.75, 1.38], [3.22, 1.00]]},
    "suv": {"L": 4.70, "W": 1.88, "R": 0.37, "xr": 0.95, "xf": 3.75,
            "top": [[0, 0.55], [0.03, 1.30], [0.20, 1.72], [2.95, 1.75], [3.45, 1.20], [4.55, 1.08], [4.70, 0.72]],
            "glass": [[0.30, 1.32], [0.42, 1.64], [2.85, 1.66], [3.25, 1.24]]},
    "pickup": {"L": 5.30, "W": 1.90, "R": 0.39, "xr": 1.05, "xf": 4.25,
               "top": [[0, 0.62], [0.02, 1.15], [1.90, 1.15], [1.95, 1.80], [3.35, 1.82], [3.85, 1.25], [5.15, 1.10], [5.30, 0.75]],
               "glass": [[2.10, 1.28], [2.18, 1.72], [3.30, 1.74], [3.68, 1.28]]},
    "coupe": {"L": 4.40, "W": 1.85, "R": 0.32, "xr": 0.90, "xf": 3.55,
              "top": [[0, 0.46], [0.05, 0.88], [0.70, 0.98], [1.55, 1.30], [2.55, 1.32], [3.20, 0.92], [4.30, 0.78], [4.40, 0.55]],
              "glass": [[0.95, 1.00], [1.65, 1.24], [2.45, 1.26], [3.00, 0.96]]},
}


def car3d_html(car_type, zones, height=420):
    """zones: dict of zone name -> status ('ok' | 'info' | 'warning' | 'critical')."""
    body = BODIES.get(car_type, BODIES["sedan"])
    colors = {k: STATUS_HEX.get(v, STATUS_HEX["ok"]) for k, v in zones.items()}
    alarm = {k: v in ("warning", "critical") for k, v in zones.items()}
    return f"""
<div id="wrap" style="position:relative;width:100%;height:{height}px;border-radius:10px;overflow:hidden;
  background-color:#121110;background-image:radial-gradient(rgba(244,241,236,.07) 1px, transparent 1.2px);
  background-size:14px 14px;border:1px solid #312D29;">
  <div style="position:absolute;left:14px;top:12px;font:500 10px 'IBM Plex Mono',Consolas,monospace;
    letter-spacing:.28em;color:#A39C92;z-index:2">LIVE MODEL · DRAG TO ROTATE</div>
  <div id="legend" style="position:absolute;right:14px;bottom:12px;font:500 10px 'IBM Plex Mono',Consolas,monospace;
    letter-spacing:.14em;color:#CBC5BC;z-index:2;text-align:right;line-height:1.7"></div>
  <div id="fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font:12px 'IBM Plex Mono',monospace;color:#A39C92">loading 3D model…</div>
</div>
<script type="importmap">
{{"imports": {{"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}}}
</script>
<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';
const B = {json.dumps(body)};
const C = {json.dumps(colors)};
const ALARM = {json.dumps(alarm)};
const wrap = document.getElementById('wrap');
document.getElementById('fallback').remove();
const W = wrap.clientWidth, H = {height};
const renderer = new THREE.WebGLRenderer({{antialias: true, alpha: true, preserveDrawingBuffer: true}});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
wrap.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
camera.position.set(-5.2, 3.0, 6.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.1;
controls.enablePan = false; controls.minDistance = 4; controls.maxDistance = 14;
controls.target.set(0, 0.75, 0);

const car = new THREE.Group(); scene.add(car);
const ink = new THREE.LineBasicMaterial({{color: 0xCBC5BC, transparent: true, opacity: 0.9}});
const faint = new THREE.LineBasicMaterial({{color: 0x6F6A62, transparent: true, opacity: 0.6}});
const yb = B.R * 0.95, half = B.W / 2;

// body: silhouette with wheel arches, extruded across the width, drawn as edges only
const s = new THREE.Shape();
s.moveTo(B.top[0][0], yb);
B.top.forEach(p => s.lineTo(p[0], p[1]));
s.lineTo(B.L, yb);
s.lineTo(B.xf + B.R + 0.08, yb);
s.absarc(B.xf, yb, B.R + 0.08, 0, Math.PI, false);
s.lineTo(B.xr + B.R + 0.08, yb);
s.absarc(B.xr, yb, B.R + 0.08, 0, Math.PI, false);
s.lineTo(B.top[0][0], yb);
const geo = new THREE.ExtrudeGeometry(s, {{depth: B.W * 0.9, bevelEnabled: true, bevelThickness: 0.06,
  bevelSize: 0.05, bevelSegments: 2, curveSegments: 18}});
geo.translate(-B.L / 2, 0, -B.W * 0.45);
car.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), ink));

// line-art contours: the silhouette repeated at a few widths, plus side glass
const outline = new THREE.BufferGeometry().setFromPoints(s.getPoints(40).map(p => new THREE.Vector3(p.x - B.L / 2, p.y, 0)));
[-0.25, 0.25].forEach(z => {{ const l = new THREE.LineLoop(outline, faint); l.position.z = z * B.W; car.add(l); }});
const glass = new THREE.BufferGeometry().setFromPoints(B.glass.map(p => new THREE.Vector3(p[0] - B.L / 2, p[1], 0)));
[-1, 1].forEach(side => {{ const g = new THREE.LineLoop(glass, ink); g.position.z = side * (half + 0.01); car.add(g); }});

// health zones: wireframe box + soft fill, pulsing when there is a warning or a fault
const pulsing = [];
function zone(name, x0, x1, y0, y1, z0, z1) {{
  const col = new THREE.Color(C[name] || '#74C79C');
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({{color: col, transparent: true, opacity: 0.13, depthWrite: false}}));
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({{color: col}}));
  const grp = new THREE.Group(); grp.add(m, e);
  grp.position.set((x0 + x1) / 2 - B.L / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  car.add(grp);
  if (ALARM[name]) pulsing.push(m);
}}
const hood = B.top[B.top.length - 2][1];
zone('engine', B.xf - 0.45, B.L - 0.25, yb + 0.05, hood - 0.08, -half * 0.62, half * 0.62);
zone('cooling', B.L - 0.22, B.L - 0.08, yb + 0.02, hood - 0.12, -half * 0.55, half * 0.55);
zone('battery', B.xf - 0.40, B.xf - 0.10, yb + 0.25, hood - 0.10, half * 0.30, half * 0.70);
zone('fuel', B.xr + 0.15, B.xr + 0.85, yb - 0.08, yb + 0.16, -half * 0.55, half * 0.55);

// wheels: tyre cylinder edges + rim + spokes, coloured by that tyre's status
function wheel(name, x, side) {{
  const col = new THREE.Color(C[name] || '#74C79C');
  const mat = new THREE.LineBasicMaterial({{color: col}});
  const grp = new THREE.Group();
  const tyre = new THREE.CylinderGeometry(B.R, B.R, 0.22, 28, 1, true);
  tyre.rotateX(Math.PI / 2);
  grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(tyre, 1), mat));
  const rim = new THREE.BufferGeometry().setFromPoints(new THREE.Path().absarc(0, 0, B.R * 0.62, 0, Math.PI * 2).getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0.11)));
  grp.add(new THREE.LineLoop(rim, mat));
  const spokes = [];
  for (let k = 0; k < 5; k++) {{ const a = k * Math.PI * 2 / 5; spokes.push(new THREE.Vector3(0, 0, 0.11), new THREE.Vector3(Math.cos(a) * B.R * 0.62, Math.sin(a) * B.R * 0.62, 0.11)); }}
  grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), mat));
  grp.position.set(x - B.L / 2, B.R, side * (half - 0.05));
  if (side < 0) grp.rotation.y = Math.PI;
  car.add(grp);
  if (ALARM[name]) {{ const glow = new THREE.Mesh(new THREE.CylinderGeometry(B.R * 1.08, B.R * 1.08, 0.26, 28).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({{color: col, transparent: true, opacity: 0.15, depthWrite: false}})); grp.add(glow); pulsing.push(glow); }}
}}
wheel('tyre_fl', B.xf, 1); wheel('tyre_fr', B.xf, -1); wheel('tyre_rl', B.xr, 1); wheel('tyre_rr', B.xr, -1);

// floor: dotted grid
const pts = [];
for (let x = -4; x <= 4.01; x += 0.25) for (let z = -3; z <= 3.01; z += 0.25) pts.push(x, 0, z);
const dots = new THREE.BufferGeometry(); dots.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
scene.add(new THREE.Points(dots, new THREE.PointsMaterial({{color: 0x4A4640, size: 0.025}})));

const names = {{engine: 'ENGINE', cooling: 'COOLING', battery: 'BATTERY', fuel: 'FUEL', tyre_fl: 'TYRE FL', tyre_fr: 'TYRE FR', tyre_rl: 'TYRE RL', tyre_rr: 'TYRE RR'}};
document.getElementById('legend').innerHTML = Object.keys(names).map(k =>
  `<span style="color:${{C[k]}}">●</span> ${{names[k]}}`).join('<br>');

const clock = new THREE.Clock();
(function loop() {{
  requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  pulsing.forEach(m => {{ const mat = m.material; mat.opacity = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 4)); }});
  controls.update();
  renderer.render(scene, camera);
}})();
</script>
"""
