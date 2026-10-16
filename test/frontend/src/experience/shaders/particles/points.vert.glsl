// Draws each particle at the position stored in the simulation texture.
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPointScale;   // render height in px / (2 tan(fov / 2))
uniform float uSize;         // world-space sprite size
uniform float uAlpha;
uniform float uFade;         // reduced-motion crossfade
uniform vec3 uColor;
uniform vec3 uAccent;

attribute vec2 aRef;
attribute vec4 aRand;

varying vec3 vColor;

void main() {
  vec4 P = texture2D(tPos, aRef);
  vec4 V = texture2D(tVel, aRef);
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;

  float e = V.w;
  float sp = clamp(length(V.xyz) * 0.16, 0.0, 1.0);
  float kp = knockPulse(uTime);
  float stall = misfireStall(aRand.y, uTime);

  float size = uSize * (0.45 + 1.1 * aRand.z * aRand.z) * (0.8 + 0.25 * min(e, 2.0)) * (1.0 + 0.5 * kp);
  float px = size * uPointScale / -mv.z;
  float a = uAlpha * uFade * (1.0 - 0.85 * stall);
  // sub-pixel sprites shimmer; keep them at 1.5 px and fade by area instead
  if (px < 1.5) {
    a *= px * px / 2.25;
    px = 1.5;
  }
  gl_PointSize = min(px, 48.0);

  float accentMix = clamp(sp * 0.85 + max(e - 1.0, 0.0) * 0.7 + kp * 0.6, 0.0, 1.0);
  float bright = (0.45 + 0.55 * aRand.w) * (0.35 + 0.65 * min(e, 2.5)) * (1.0 + sp * 1.4 + kp * 1.2);
  vColor = mix(uColor, uAccent, accentMix) * bright * a;
}
