uniform sampler2D tVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(tVelocity, vL).x;
  float R = texture2D(tVelocity, vR).x;
  float T = texture2D(tVelocity, vT).y;
  float B = texture2D(tVelocity, vB).y;
  vec2 C = texture2D(tVelocity, vUv).xy;
  // solid walls at the screen edges
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
