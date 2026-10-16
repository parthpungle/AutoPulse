// Draws each particle at the position stored in the simulation texture.
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPointScale;   // render height in px / (2 tan(fov / 2))
uniform float uSize;         // world-space sprite size
uniform float uAlpha;
uniform float uFade;         // reduced-motion crossfade
uniform vec3 uColor;
uniform vec3 uAccent;
// Sensor Array flows take their sensor's colour
uniform sampler2D tStreams;     // the section-1 target (pool code in .x, see shapes.glsl)
uniform float uSecA;
uniform float uSecB;
uniform float uMorph;
uniform vec3 uSensorColors[8];
uniform float uActiveSensor;
uniform vec3 uActiveTip;        // world position of the active sensor's tip

uniform sampler2D tClusters;    // the section-3 target (cluster id in .w)
uniform vec3 uClusterColors[4];

attribute vec2 aRef;
attribute vec4 aRand;

varying vec3 vColor;

void main() {
  vec4 P = texture2D(tPos, aRef);
  vec4 V = texture2D(tVel, aRef);
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;

  // how much of this particle's shape is the Sensor Array (w1) or Recognition (w3), with the same
  // staggered morph as the simulation
  float m = smoothstep(aRand.x * 0.4, 0.6 + aRand.x * 0.4, uMorph);
  float w1 = (abs(uSecA - 1.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 1.0) < 0.5 ? m : 0.0);
  float w3 = (abs(uSecA - 3.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 3.0) < 0.5 ? m : 0.0);
  // the global engine state never styles the clusters
  float global = 1.0 - w3;

  float e = V.w;
  float sp = clamp(length(V.xyz) * 0.16, 0.0, 1.0);
  float kp = knockPulse(uTime) * global;
  float stall = misfireStall(aRand.y, uTime) * global;

  // Recognition: each cluster in its own colour; Default shows all four at 70%, a selection lifts
  // its cluster to 100% (+15% size) and dims the others to 30%
  vec3 clColor = uColor * 0.8;
  float clBright = mix(0.7, 0.3, uAnySel);
  float clSize = 1.0;
  if (w3 > 0.0) {
    int ci = int(texture2D(tClusters, aRef).w + 0.5);
    if (ci < 4) {
      float sel = uClusterSel[ci];
      clColor = uClusterColors[ci];
      clBright = mix(0.7, mix(0.3, 1.0, sel), uAnySel);
      clSize = 1.0 + 0.15 * sel;
      // valve wear: a fine high-frequency jitter, on screen
      if (ci == 3) {
        vec2 j = fract(sin(vec2(dot(aRef, vec2(12.9898, 78.233)), dot(aRef, vec2(39.3468, 11.135))) + floor(uTime * 40.0)) * 43758.5453) - 0.5;
        gl_Position.xy += j * 0.007 * gl_Position.w * w3;
      }
    }
  }

  float size = uSize * (0.45 + 1.1 * aRand.z * aRand.z) * (0.8 + 0.25 * min(e, 2.0)) * (1.0 + 0.5 * kp) * mix(1.0, clSize, w3);
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

  vec3 base = uColor;
  if (w1 > 0.0) {
    vec4 D = texture2D(tStreams, aRef);
    vec3 c = uColor;
    int act = int(uActiveSensor + 0.5);
    if (D.x > 9.5 && D.x < 18.5) {
      c = uSensorColors[int(D.x - 9.5)];
    } else if (D.x > 19.5 && D.x < 29.5) {
      c = uSensorColors[act];
      // CAN: each packet keeps the colour of the sensor it came from
      if (act == 7) c = uSensorColors[int(floor(fract(D.w * 7.31) * 7.0))];
      // coolant: cool off the block, warming to orange as it reaches the probe
      if (act == 3) c = mix(vec3(0.31, 0.72, 1.0), c, 1.0 - smoothstep(0.25, 2.2, distance(P.xyz, uActiveTip)));
    } else if (D.x > 29.5) {
      c = uSensorColors[act];
    }
    base = mix(uColor, c * 1.25, w1);
  }
  base = mix(base, clColor * 1.2, w3);

  float accentMix = clamp(sp * 0.85 + max(e - 1.0, 0.0) * 0.7 + kp * 0.6, 0.0, 1.0) * (1.0 - w1) * global;
  float bright = (0.45 + 0.55 * aRand.w) * (0.35 + 0.65 * min(e, 2.5)) * (1.0 + sp * 1.4 + kp * 1.2) * mix(1.0, clBright, w3);
  vColor = mix(base, uAccent, accentMix) * bright * a;
}
