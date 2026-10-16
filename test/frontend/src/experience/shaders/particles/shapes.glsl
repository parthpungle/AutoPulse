// Section shapes. Each target texture holds parametric coordinates per particle; the shape is
// evaluated here every frame so it stays alive and reacts to the engine state.
// Layout numbers (world units) come from Layout.ts so DOM labels can be pinned to the same points.
//   xyz = home position, w = emphasis (1 normal, >1 brighter and warmer, <1 dimmer)

uniform vec4 uL0;   // hero      : half width, amplitude, thickness, y offset
uniform vec4 uL2;   // spectrum  : centre x, width, height, base y
uniform vec4 uL3;   // clusters  : centre x, centre y, half width, half height
uniform vec4 uL4;   // ring      : centre x, centre y, radius, thickness
uniform vec2 uClusterC[4];

const float PI = 3.14159265359;

vec4 shapeHero(vec4 d, float t) {
  float s = d.x;
  float u = s * PI;
  float pulsePos = fract(t * 0.16) * 2.8 - 1.4;
  float pulse = gauss((s - pulsePos) * 4.5);
  float kp = knockPulse(t);
  float wave = 0.34 * sin(u * 1.15 + t * 0.55)
             + 0.19 * sin(u * 2.7 - t * 0.9 + 1.3)
             + 0.09 * sin(u * 5.3 + t * 1.7 + 2.1)
             + 0.045 * sin(u * 10.9 - t * 2.6 + 0.4);
  float taper = smoothstep(1.0, 0.5, abs(s));
  float thick = uL0.z * (0.3 + 0.7 * taper) * (1.0 + 0.9 * pulse);
  float y = wave * uL0.y * (1.0 + 0.3 * pulse + 0.5 * kp * sin(u * 9.0)) + uL0.w + d.y * thick;
  float z = d.z * thick * 1.4 + 0.6 * sin(u * 0.7 + t * 0.3);
  return vec4(s * uL0.x, y, z, 1.0 + 1.3 * pulse);
}

// Sensor Array: signal flows (paths in sim/Paths.ts, timing in sim/Flows.ts). Every particle
// belongs to a pool, and every visible one either flows into a sensor or carries its data:
//   8      deep-field dust far around the crank
//   10+j   trickle along sensor j's path: faint and slow, so all eight colours always show
//   20     the active sensor's phenomenon flow, shaped by what that sensor hears
//   30     the active sensor's data: thin dashes from its cable to the OBD-II port
// d = (pool, phase, radius 0..1, angle 0..1)
uniform sampler2D tPaths;     // 128 x 16 rig-space samples: xyz, local scale
uniform vec3 uRigOffset;      // the rig's translation (paths are stored in rig space)
uniform float uActiveSensor;
uniform float uFlowPhase[8];  // integrated phase per sensor (path lengths travelled)
uniform float uDataPhase;
uniform float uThrottle;      // 0..1
uniform float uLambda;        // -1 lean .. 1 rich
uniform float uFlowDensity;   // ?debug knob, 1 by default
uniform float uDataHalf;      // 1 on tiers 0-1: half the data dashes are hidden

// set by shapeSensors for the velocity pass: this particle rides a flow (track its home closely),
// and how far along its path it is (just wrapped: jump back to the start, don't fly back)
float gFlow = 0.0;
float gU = 0.5;

// position, unit tangent and local scale at u along a path row
void pathAt(float row, float u, out vec3 p, out vec3 tg, out float w) {
  float x = clamp(u, 0.0, 1.0) * 127.0;
  float i0 = min(floor(x), 126.0);
  float v = (row + 0.5) / 16.0;
  vec4 a = texture2D(tPaths, vec2((i0 + 0.5) / 128.0, v));
  vec4 b = texture2D(tPaths, vec2((i0 + 1.5) / 128.0, v));
  vec4 m = mix(a, b, x - i0);
  p = m.xyz + uRigOffset;
  w = m.w;
  tg = b.xyz - a.xyz;
  float l = length(tg);
  tg = l > 1e-5 ? tg / l : vec3(0.0, 1.0, 0.0);
}

// a unit vector perpendicular to the tangent, at angle `ang` around it
vec3 around(vec3 tg, float ang) {
  vec3 ref = abs(tg.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 n1 = normalize(cross(tg, ref));
  vec3 n2 = cross(tg, n1);
  return n1 * cos(ang) + n2 * sin(ang);
}

float hash11(float x) {
  return hash12(vec2(x, x * 0.6180339 + 17.0));
}

// fade in at the source, out at the end
float ends(float u, float a, float b) {
  return smoothstep(0.0, a, u) * smoothstep(1.0, 1.0 - b, u);
}

vec4 flowActive(vec4 d, float t) {
  int a = int(uActiveSensor + 0.5);
  float ph = uFlowPhase[a];
  float ang = d.w * 2.0 * PI;
  vec3 p;
  vec3 tg;
  float w;
  float e = 1.2;
  float u;
  gFlow = 1.0;
  if (a == 0) {
    // acoustic: wavefront shells leave the block, swell, then converge into the grille;
    // knock packs them tighter and brighter, valve wear makes every third shell tick
    float N = mix(6.0, 10.0, uKnock);
    float k = floor(d.y * N);
    u = fract(k / N + ph) + (fract(d.y * N) - 0.5) * 0.014;
    pathAt(0.0, u, p, tg, w);
    float R = 0.62 * w * smoothstep(0.0, 0.3, u) * pow(max(1.0 - u, 0.0), 0.8);
    p += around(tg, ang) * R * (0.8 + 0.2 * d.z) + tg * R * 0.3 * (d.z - 0.5);
    e = (1.0 + 0.7 * smoothstep(0.75, 1.0, u)) * (1.0 + uValve * 1.6 * step(mod(k, 3.0), 0.5)) * (1.0 + 0.8 * knockPulse(t));
    e *= ends(u, 0.05, 0.03);
  } else if (a == 1) {
    // vibration: crawls along the crank's surface with a fine lateral shake (finer still with
    // valve wear); knock fires bursts of brightness
    u = fract(d.y + ph);
    pathAt(1.0, u, p, tg, w);
    float jit = (hash12(vec2(d.w * 91.0, floor(t * 30.0))) - 0.5) * (0.07 + 0.08 * uValve) * w;
    p += around(tg, ang) * (0.035 * d.z * w + jit);
    e = (1.0 + 0.4 * smoothstep(0.8, 1.0, u) + 2.4 * knockPulse(t)) * ends(u, 0.06, 0.03);
  } else if (a == 2) {
    // crank position: one blip per passing tooth, from the trigger wheel into the tip, with the
    // two missing teeth leaving a gap every revolution; misfire makes the spacing uneven
    const float B = 24.0;
    float k = floor(d.y * B);
    float cyc = k / B + ph;
    float tooth = B * floor(cyc) - k;
    float missing = step(58.0, mod(tooth, 60.0));
    u = fract(cyc + uMisfire * 0.035 * sin(tooth * 1.7)) + (fract(d.y * B) - 0.5) * 0.01;
    pathAt(2.0, u, p, tg, w);
    p += around(tg, ang) * 0.03 * d.z * w;
    e = (1.25 + 0.5 * smoothstep(0.85, 1.0, u)) * (1.0 - missing) * ends(u, 0.04, 0.02);
  } else if (a == 3) {
    // coolant: a slow, wide, warm drift off the block into the probe (it warms in colour as it
    // nears the tip, in the draw pass)
    u = fract(d.y + ph);
    pathAt(3.0, u, p, tg, w);
    float spread = 0.34 * w * (1.0 - 0.85 * u) * sqrt(d.z);
    p += around(tg, ang + t * 0.25 + u * 3.0) * spread;
    p.y += 0.07 * sin(t * 0.8 + d.w * 9.0) * (1.0 - u);
    // slow means dense: keep it dim so the overlap doesn't burn out
    e = (0.45 + 0.4 * smoothstep(0.7, 1.0, u)) * ends(u, 0.2, 0.04);
  } else if (a == 4) {
    // throttle: air streaks through the bore past the butterfly; more streaks the wider it opens
    const float S = 40.0;
    float k = floor(d.y * S);
    float h = hash11(k * 7.13 + 3.0);
    u = fract(k / S + ph) + (fract(d.y * S) - 0.5) * 0.07;
    pathAt(4.0, u, p, tg, w);
    p += around(tg, fract(h * 31.7) * 2.0 * PI) * 0.17 * w * sqrt(fract(h * 13.1));
    e = 1.15 * step(h, 0.2 + 0.8 * uThrottle) * ends(u, 0.15, 0.15);
  } else if (a == 5) {
    // lambda: an exhaust plume sweeping over the tip, brighter rich, dimmer lean
    u = fract(d.y + ph);
    pathAt(5.0, u, p, tg, w);
    float spread = (0.04 + 0.3 * u * u) * w;
    p += around(tg, ang + snoise(vec3(u * 3.0, d.w * 5.0, t * 0.7)) * 1.5) * spread * sqrt(d.z);
    e = (0.4 + 0.5 * (0.5 + 0.5 * uLambda)) * ends(u, 0.1, 0.3);
  } else if (a == 6) {
    // current: a helix along the cable through the clamp's jaw, in pulse groups at injector
    // timing; misfire drops one group in four
    u = fract(d.y + ph);
    pathAt(6.0, u, p, tg, w);
    float gi = floor(d.y * 6.0) + 6.0 * floor(d.y + ph);
    float on = step(fract(d.y * 6.0), 0.45) * (1.0 - uMisfire * step(3.0, mod(gi, 4.0)));
    p += around(tg, ang * 0.12 + u * 22.0 * 2.0 * PI - t * 3.0) * 0.075 * w * (0.85 + 0.3 * d.z);
    e = 1.25 * on * ends(u, 0.1, 0.1);
  } else {
    // OBD-II / CAN: packets from the other seven sensors converge on the port
    float j = floor(fract(d.w * 7.31) * 7.0);
    u = fract(d.y + ph);
    pathAt(8.0 + j, u, p, tg, w);
    p += around(tg, ang) * 0.015 * d.z;
    e = 1.1 * step(fract(d.y * 10.0), 0.4) * ends(u, 0.05, 0.02);
  }
  // the ?debug density knob thins the flow
  e *= step(fract(d.y * 13.37 + d.w * 7.1), uFlowDensity);
  gU = fract(u);
  return vec4(p, e);
}

vec4 shapeSensors(vec4 d, float t) {
  vec3 p;
  vec3 tg;
  float w;
  if (d.x < 9.0) {
    // dust
    float ang = d.w * 2.0 * PI + t * 0.02 * (0.4 + d.z);
    float r = 4.5 + d.z * 7.0;
    float y = mix(-9.0, 6.0, d.y) + 0.25 * sin(t * 0.2 + d.w * 6.28);
    return vec4(cos(ang) * r, y, sin(ang) * r, 0.1 + 0.12 * d.z);
  }
  if (d.x < 19.0) {
    // trickle: sensor j's path, a third of the speed, about a tenth of the brightness
    int j = int(d.x - 10.0 + 0.5);
    float u = fract(d.y + uFlowPhase[j] * 0.3);
    gFlow = 1.0;
    gU = u;
    pathAt(j == 7 ? 15.0 : float(j), u, p, tg, w);
    p += around(tg, d.w * 2.0 * PI) * 0.045 * d.z * w;
    return vec4(p, 0.016 * ends(u, 0.1, 0.1));
  }
  if (d.x < 29.0) return flowActive(d, t);
  // data: dashes from the active sensor's cable to the port (the CAN card has its own flow)
  int a = int(uActiveSensor + 0.5);
  float u = fract(d.y + uDataPhase);
  gFlow = 1.0;
  gU = u;
  pathAt(8.0 + float(a), u, p, tg, w);
  p += around(tg, d.w * 2.0 * PI) * 0.012 * d.z;
  float on = step(fract(d.y * 14.0), 0.35) * step(uDataHalf * 0.5, fract(d.w * 3.7)) * (a == 7 ? 0.0 : 1.0);
  return vec4(p, 0.95 * on * ends(u, 0.04, 0.04));
}

// A fake engine spectrum, f in 0..1 of a 12 kHz span.
float fakeSpectrum(float f, float t) {
  float f0 = 0.052 * (1.0 + 0.02 * sin(t * 0.35));
  float s = 0.0;
  for (int k = 1; k <= 9; k++) {
    float a = 1.25 / (0.5 + 0.45 * float(k));
    s += a * gauss((f - f0 * float(k)) / 0.016);
  }
  s += 0.28 * gauss((f - 0.34) / 0.06);
  s += 0.07 + 0.06 * snoise(vec3(f * 14.0, t * 0.9, 3.1)) * uTurb;
  // knock rings in the 5.5-8 kHz band right after each firing
  s += uKnock * exp(-beatPhase(t) * 9.0) * 0.85 * gauss((f - 0.56) / 0.08);
  // misfire: half-order lines and a periodic drop of every harmonic
  s += uMisfire * 0.45 * (gauss((f - f0 * 0.5) / 0.008) + gauss((f - f0 * 1.5) / 0.008));
  s *= 1.0 - 0.45 * uMisfire * step(3.0, mod(floor(t * uBeat), 4.0));
  // valve wear: a high-frequency comb that ticks
  s += uValve * 0.32 * smoothstep(0.62, 0.92, f) * (0.5 + 0.5 * sin(f * 230.0 + t * 20.0));
  return clamp(s, 0.03, 1.15);
}

vec4 shapeSpectrum(vec4 d, float t) {
  const float COLS = 40.0;
  const float ROWS = 6.0;
  float col = min(floor(d.x * COLS), COLS - 1.0);
  float row = min(floor(d.z * ROWS), ROWS - 1.0);
  float f = (col + 0.5) / COLS;
  float h = fakeSpectrum(f, t - row * 0.22);
  float colW = uL2.y / COLS;
  float x = uL2.x - uL2.y * 0.5 + (col + 0.5) * colW + (d.w - 0.5) * colW * 0.26;
  float y = uL2.w + d.y * h * uL2.z;
  float z = 1.4 - row * 0.75;
  float e = (0.45 + 0.9 * d.y * h) * (1.0 - row / ROWS * 0.85);
  return vec4(x, y, z, e);
}

// Recognition: four clusters with permanent identities. Each moves on its own clock and never on
// the global engine state: healthy drifts calm and tight, knock throws sharp outward spikes, misfire
// flickers and drops a slice out every few beats, valve wear jitters (that fine jitter is added in
// the draw pass: the spring would smooth it away here). Colour, and the selection's size and
// brightness, are in the draw pass too.
vec4 shapeClusters(vec4 d, float t) {
  float id = d.w;
  int i = int(id + 0.5);
  vec2 c = vec2(0.0);
  float sel = 0.0;
  if (i < 4) {
    c = uClusterC[i];
    sel = uClusterSel[i];
  }
  vec2 q = d.xy - c;
  float h = hash12(d.xy * 731.0 + d.z * 17.0); // a constant per particle
  float e = 1.0;
  float spread = 1.0 + 0.15 * sel;
  float rot = 0.0;
  if (i == 0) {
    spread *= 0.88 * (1.0 + 0.02 * sin(t * 0.6 + h * 6.28));
    rot = 0.05 * sin(t * 0.12);
  } else if (i == 1) {
    float kb = exp(-fract(t * 1.15) * 9.0);
    spread *= 1.0 + kb * (0.22 + 0.75 * step(0.6, h));
    rot = 0.04 * sin(t * 0.3);
  } else if (i == 2) {
    float beat = floor(t * 1.4);
    float drop = step(2.0, mod(beat, 3.0)) * step(h, 0.35);
    e = (0.78 + 0.22 * sin(t * 21.0 + h * 40.0)) * (1.0 - drop);
    spread *= 1.0 + 0.03 * sin(t * 1.4 + h * 6.28);
  } else if (i == 3) {
    spread *= 1.0 + 0.02 * sin(t * 0.9 + h * 6.28);
  } else {
    e = 0.5; // outliers between the clusters
  }
  q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * (q * spread);
  vec2 p = c + q;
  return vec4(uL3.x + p.x * uL3.z, uL3.y + p.y * uL3.w, d.z, e);
}

vec4 shapeRing(vec4 d, float t) {
  float outer = step(d.w, 0.18);
  float th = d.x * 2.0 * PI + t * mix(0.07, -0.04, outer);
  float R = uL4.z * mix(1.0, 1.18, outer) * (1.0 + 0.04 * sin(t * 0.9));
  float thick = uL4.w * mix(1.0, 0.3, outer);
  float r = R + d.y * thick;
  vec3 p = vec3(cos(th) * r, sin(th) * r, d.z * thick * 1.2);
  float tilt = 0.22 * sin(t * 0.17);
  p.xz = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * p.xz;
  p.xy += uL4.xy;
  float e = mix(1.05, 0.6, outer) + 0.3 * sin(th * 3.0 - t * 1.4);
  return vec4(p, e);
}

vec4 shape(float sec, vec4 d, float t) {
  if (sec < 0.5) return shapeHero(d, t);
  if (sec < 1.5) return shapeSensors(d, t);
  if (sec < 2.5) return shapeSpectrum(d, t);
  if (sec < 3.5) return shapeClusters(d, t);
  return shapeRing(d, t);
}
