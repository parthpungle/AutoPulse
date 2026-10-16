// Combines the backdrop and particle layers. Section changes bend the particle layer slightly
// (a small radial colour split at mid-morph); the intro wipe is drawn here too.
uniform sampler2D tBackdrop;
uniform sampler2D tParticles;
uniform float uReveal;
uniform float uFadeReveal;   // reduced motion: plain fade instead of the wipe
uniform float uTrans;
uniform float uFlash;
uniform float uTime;
uniform float uAspect;
uniform vec3 uBg;
uniform vec3 uAccent;
varying vec2 vUv;

void main() {
  vec3 bd = texture2D(tBackdrop, vUv).rgb;
  vec2 dir = vUv - 0.5;
  float k = 0.006 * uTrans;
  vec3 pt = vec3(
    texture2D(tParticles, vUv - dir * k).r,
    texture2D(tParticles, vUv).g,
    texture2D(tParticles, vUv + dir * k).b
  );
  vec3 col = bd + pt;
  col += uAccent * uFlash * 0.04 * (1.0 - smoothstep(0.0, 0.8, length(dir)));

  if (uReveal < 1.0) {
    if (uFadeReveal > 0.5) {
      col = mix(uBg, col, uReveal);
    } else {
      float n = snoise(vec3(vUv.x * uAspect * 2.2, vUv.y * 2.2, uTime * 0.15)) * 0.06;
      float e = vUv.x * 0.62 + (1.0 - vUv.y) * 0.38 + n;
      float r = uReveal * 1.3 - 0.15;
      float hidden = smoothstep(r - 0.015, r + 0.015, e);
      float line = gauss((e - r) / 0.006) * step(0.0001, uReveal);
      col = mix(col, uBg, hidden) + uAccent * line * 1.4;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
