// Very dark radial gradient with slow noise; its centre drifts with the scroll. Never flat black.
uniform float uTime;
uniform float uSection;
uniform float uFlash;
uniform vec2 uRes;
uniform vec3 uBg;
uniform vec3 uAccent;
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
  vec2 p = vUv - 0.5;
  p.x *= uRes.x / uRes.y;
  float s = uSection;
  float side = smoothstep(0.6, 2.0, s) * (1.0 - smoothstep(3.0, 3.9, s));
  vec2 c = vec2(0.3 * side * min(uRes.x / uRes.y, 1.6), mix(0.08, 0.0, smoothstep(0.0, 1.0, s)));
  float r = length(p - c);
  float glow = exp(-r * r * 2.6);
  float n = fbm(vec3(p * 1.4, uTime * 0.025));
  vec3 col = uBg;
  col += vec3(0.0034, 0.0041, 0.0055) * glow * (1.0 + 0.7 * n);
  col += uAccent * (0.0028 + 0.02 * uFlash) * glow * (0.6 + 0.4 * n);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
