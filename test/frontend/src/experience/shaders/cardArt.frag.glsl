// Paints one sensor card's artwork into its own small render target (see Cards.renderArt):
// the sensor's signal as soft ink clouds in the sensor colour. Doing this at 512x320 instead of
// per screen pixel keeps the cards cheap; the soft result is what the glass shows anyway.
// rgb = artwork, a = the ink field (0..1), reused by the card shader for its refraction wobble.
uniform float uSensor;
uniform float uAmp;
uniform float uOct;
uniform vec2 uAspect;
uniform vec3 uColor;
uniform vec4 uSig;  // throttle, short-term fuel trim / 10, rpm 0..1, coolant 0..1
varying vec2 vUv;

float fbmN(vec2 p, float oct) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= oct) break;
    s += a * snoise(vec3(p, uTime * 0.05 + float(i) * 7.13));
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

// domain-warped fbm: the "ink in water" field everything is painted with
float ink(vec2 p, float oct) {
  vec2 q = vec2(fbmN(p + vec2(0.0, uTime * 0.03), oct), fbmN(p + vec2(5.2, 1.3) - uTime * 0.025, oct));
  return fbmN(p + 1.6 * q, oct);
}

float band(float d, float w) {
  return exp(-d * d / (w * w));
}

// Each sensor's signal, as an intensity field over the card (uv 0..1).
float signalField(vec2 w, float t) {
  float s = uSensor;
  if (s < 0.5) {
    // acoustic: scrolling spectrogram smear; knock adds bright vertical streaks
    float x = w.x + t * 0.06;
    float colId = floor(x * 16.0);
    float energy = 0.55 + 0.45 * snoise(vec3(colId * 0.37, 0.0, t * 0.35));
    float f = 0.0;
    for (int k = 1; k <= 5; k++) {
      float fk = float(k);
      f += band(w.y - (0.12 + 0.14 * fk + 0.015 * sin(x * 4.0 + fk)), 0.03) * (1.3 / fk);
    }
    float hit = step(0.82, hash12(vec2(colId, floor(t * uBeat)))) * exp(-beatPhase(t) * 6.0);
    float streak = uKnock * hit * band(fract(x * 16.0) - 0.5, 0.18) * smoothstep(0.05, 0.3, w.y) * smoothstep(0.95, 0.7, w.y);
    return f * energy + streak * 1.6;
  } else if (s < 1.5) {
    // vibration: dense ribbon with a burst envelope at every firing
    float ph = fract(w.x * 3.0 - t * 0.5);
    float env = exp(-ph * 5.0) * smoothstep(0.0, 0.03, ph);
    float y = 0.5 + (0.26 * env + 0.02) * sin(w.x * 130.0 + t * 3.0) * (1.0 + 0.6 * uKnock);
    return band(w.y - y, 0.012 + 0.02 * env) * (0.45 + env) + 0.2 * band(w.y - 0.5, 0.22) * env;
  } else if (s < 2.5) {
    // crank position: the 60-2 pulse train with the two-tooth gap sweeping across
    float x = w.x - t * 0.12;
    float teeth = fract(x * 29.0);
    float gap = step(fract(x), 2.0 / 29.0);
    float hi = step(0.5, teeth) * (1.0 - gap);
    float y = mix(0.4, 0.6, hi);
    float edge = band(min(teeth, abs(teeth - 0.5)) / 29.0, 0.0014) * step(0.39, w.y) * step(w.y, 0.61) * (1.0 - gap);
    return band(w.y - y, 0.011) + edge + 0.12 * hi * band(w.y - 0.5, 0.1);
  } else if (s < 3.5) {
    // coolant: a slow thermal gradient that rises and settles
    float level = 0.3 + 0.45 * uSig.w + 0.03 * sin(t * 0.4 + w.x * 3.0);
    float heat = smoothstep(level + 0.22, level - 0.18, w.y);
    return heat * 0.55 + band(w.y - level, 0.02) * 0.8;
  } else if (s < 4.5) {
    // throttle: stepped plateaus with smooth ramps
    float x = w.x * 6.0 - t * 0.25;
    float seg = floor(x);
    float f = fract(x);
    float v0 = 0.25 + 0.5 * hash12(vec2(seg, 3.1));
    float v1 = 0.25 + 0.5 * hash12(vec2(seg + 1.0, 3.1));
    float y = mix(v0, v1, smoothstep(0.75, 1.0, f));
    return band(w.y - y, 0.013) + 0.18 * step(w.y, y) * smoothstep(y - 0.35, y, w.y);
  } else if (s < 5.5) {
    // lambda: rich/lean switching line around the stoichiometric axis
    float y = 0.5 + 0.22 * tanh(sin(w.x * 10.0 - t * 2.2) * 4.0) + 0.04 * uSig.y;
    return band(w.y - y, 0.012) + 0.35 * band(w.y - 0.5, 0.003) + 0.12 * band(w.y - y, 0.08);
  } else if (s < 6.5) {
    // current: repeating ramp pulses with a hump, then the hold plateau
    float p = fract(w.x * 3.0 - t * 0.3);
    float on = step(p, 0.45);
    float ramp = min(1.0, p / 0.08);
    float hump = band(p - 0.12, 0.03) * 0.35;
    float hold = p > 0.15 ? 0.35 : 0.0;
    float y = 0.28 + 0.42 * on * (ramp * 1.1 + hump - hold);
    return band(w.y - y, 0.012) + 0.1 * on * step(w.y, y) * step(0.28, w.y);
  }
  // CAN: packets racing along parallel lanes
  float lanes = 7.0;
  float lane = floor(w.y * lanes);
  float x = w.x * 22.0 - t * (2.5 + lane * 0.6);
  float cell = floor(x);
  float on = step(0.45, hash12(vec2(cell, lane)));
  float dash = on * smoothstep(0.0, 0.12, fract(x)) * smoothstep(1.0, 0.75, fract(x));
  return dash * band(fract(w.y * lanes) - 0.5, 0.14) + 0.15 * band(fract(w.y * lanes) - 0.5, 0.03);
}

void main() {
  vec2 p = (vUv - 0.5) * uAspect * 2.2 + uSensor * 3.7;
  float k = ink(p, uOct);
  float t = uTime;
  vec2 w = vUv + vec2(k * 0.025, k * 0.04);
  float m = signalField(w, t) * (0.65 + 0.7 * uAmp);
  float wash = smoothstep(-0.25, 0.65, k);
  vec3 tint = mix(uColor, vec3(1.0), 0.25);
  vec3 art = uColor * wash * 0.32 + mix(uColor, tint, clamp(m - 0.6, 0.0, 1.0)) * m * (0.6 + 0.8 * clamp(k + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(art, clamp(k * 0.5 + 0.5, 0.0, 1.0));
}
