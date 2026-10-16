// Atmosphere behind everything: an ink-navy vertical gradient with two large soft hazes
// (violet bottom-left, teal upper-right) that breathe and drift on low-frequency noise, shift a
// little with scroll and lean ~10% toward the active sensor's colour. A faint fog band sits in
// the lower third to give the scene a floor. Never flat black.
uniform float uTime;
uniform float uFlash;
uniform float uScroll;     // 0..1 over the page
uniform float uTintAmt;    // 0..1, how much the sensor tint applies (sensor section)
uniform vec2 uRes;
uniform vec3 uBg0;         // top
uniform vec3 uBg1;         // bottom
uniform vec3 uViolet;
uniform vec3 uTeal;
uniform vec3 uFog;
uniform vec3 uTint;
uniform vec3 uAccent;
uniform vec4 uHazeV;       // centre (uv), radius (screen heights), strength
uniform vec4 uHazeT;
uniform float uBand;       // fog band strength
varying vec2 vUv;

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * snoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec3 col = mix(uBg1, uBg0, smoothstep(0.0, 1.0, vUv.y));

  vec2 warp = vec2(fbm(vec3(vUv * 1.2, t * 0.02)), fbm(vec3(vUv * 1.2 + 7.3, t * 0.02))) * 0.08;
  vec2 q = (vUv + warp - 0.5) * vec2(aspect, 1.0);
  vec2 cv = (uHazeV.xy + vec2(0.05, 0.1) * sin(uScroll * 3.1) - 0.5) * vec2(aspect, 1.0);
  vec2 ct = (uHazeT.xy + vec2(-0.06, -0.08) * sin(uScroll * 2.3 + 1.0) - 0.5) * vec2(aspect, 1.0);

  float nv = 0.7 + 0.6 * fbm(vec3(q * 1.6, t * 0.03));
  float nt = 0.7 + 0.6 * fbm(vec3(q * 1.6 + 3.1, t * 0.03));
  float gv = exp(-dot(q - cv, q - cv) / (uHazeV.z * uHazeV.z)) * uHazeV.w * (0.85 + 0.15 * sin(t * 0.21)) * nv;
  float gt = exp(-dot(q - ct, q - ct) / (uHazeT.z * uHazeT.z)) * uHazeT.w * (0.85 + 0.15 * sin(t * 0.17 + 2.0)) * nt;

  vec3 violet = mix(uViolet, uTint, 0.1 * uTintAmt);
  vec3 teal = mix(uTeal, uTint, 0.1 * uTintAmt);
  col = mix(col, violet, clamp(gv, 0.0, 1.0));
  col = mix(col, teal, clamp(gt, 0.0, 1.0));

  // floor: a faint lighter band in the lower third, slightly broken up by noise
  float band = gauss((vUv.y - 0.3 + 0.02 * fbm(vec3(vUv.x * 2.0, 0.0, t * 0.02))) / 0.1);
  col += uFog * band * uBand;

  col += uAccent * 0.03 * uFlash * (gv + gt);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
