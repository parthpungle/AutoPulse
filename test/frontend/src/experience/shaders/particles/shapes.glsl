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

// Sensor Array (interim until the signal streams land): only ~12% of particles show, as slow,
// faint deep-field dust far around the crankshaft; the rest rest on the axis, invisible (e = 0).
// d = (angle, height, radius, random), all 0..1.
vec4 shapeSensors(vec4 d, float t) {
  if (d.w > 0.12) return vec4(0.0, mix(-6.0, 3.0, d.y), 0.0, 0.0);
  float ang = d.x * 2.0 * PI + t * 0.02 * (0.4 + d.w * 8.0);
  float r = 4.5 + d.z * 7.0;
  float y = mix(-9.0, 6.0, d.y) + 0.25 * sin(t * 0.2 + d.x * 6.28);
  return vec4(cos(ang) * r, y, sin(ang) * r, 0.12 + 0.12 * d.z);
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

vec4 shapeClusters(vec4 d, float t) {
  float id = d.w;
  int i = int(id + 0.5);
  vec2 c = vec2(0.0);
  float sel = 0.0;
  if (i < 4) {
    c = uClusterC[i];
    sel = uStateW[i];
  }
  float anySel = clamp(uStateW.x + uStateW.y + uStateW.z + uStateW.w, 0.0, 1.0);
  float breathe = 1.0 + 0.035 * sin(t * 1.3 + id * 1.7);
  vec2 p = c + (d.xy - c) * (1.0 + 0.2 * sel) * breathe;
  float a = 0.06 * sin(t * 0.21 + id);
  p = c + mat2(cos(a), -sin(a), sin(a), cos(a)) * (p - c);
  vec3 pos = vec3(uL3.x + p.x * uL3.z, uL3.y + p.y * uL3.w, d.z);
  float e = i < 4 ? mix(1.0, 0.24 + 2.0 * sel, anySel) : mix(0.5, 0.2, anySel);
  return vec4(pos, e);
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
