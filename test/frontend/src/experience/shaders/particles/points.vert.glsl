// Draws each particle at the position stored in the simulation texture.
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPointScale;   // render height in px / (2 tan(fov / 2))
uniform float uSize;         // world-space sprite size
uniform float uAlpha;
uniform float uFade;         // reduced-motion crossfade
uniform vec3 uColor;
uniform vec3 uAccent;
// Sensor Array streams take their sensor's colour
uniform sampler2D tStreams;     // the section-1 target (stream id in .x)
uniform float uSecA;
uniform float uSecB;
uniform float uMorph;
uniform vec3 uSensorColors[8];

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
  // particles that drift right up to the lens (orbit camera) fade instead of filling the screen
  a *= smoothstep(0.9, 2.6, -mv.z);
  // emphasis 0 means "not part of this shape": invisible
  a *= smoothstep(0.0, 0.04, e);
  // sub-pixel sprites shimmer; keep them at 1.5 px and fade by area instead
  if (px < 1.5) {
    a *= px * px / 2.25;
    px = 1.5;
  }
  gl_PointSize = min(px, 48.0);

  // weight of the Sensor Array shape for this particle (same staggered morph as the simulation)
  float m = smoothstep(aRand.x * 0.4, 0.6 + aRand.x * 0.4, uMorph);
  float w1 = (abs(uSecA - 1.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 1.0) < 0.5 ? m : 0.0);
  vec3 base = uColor;
  if (w1 > 0.0) {
    float id = texture2D(tStreams, aRef).x;
    if (id < 7.5) base = mix(uColor, uSensorColors[int(id + 0.5)] * 1.25, w1);
  }

  float accentMix = clamp(sp * 0.85 + max(e - 1.0, 0.0) * 0.7 + kp * 0.6, 0.0, 1.0) * (1.0 - w1);
  float bright = (0.45 + 0.55 * aRand.w) * (0.35 + 0.65 * min(e, 2.5)) * (1.0 + sp * 1.4 + kp * 1.2);
  vColor = mix(base, uAccent, accentMix) * bright * a;
}
