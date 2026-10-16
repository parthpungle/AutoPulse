// Subtracts the pressure gradient, leaving a divergence-free velocity field.
uniform sampler2D tPressure;
uniform sampler2D tVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(tPressure, vL).x;
  float R = texture2D(tPressure, vR).x;
  float T = texture2D(tPressure, vT).x;
  float B = texture2D(tPressure, vB).x;
  vec2 v = texture2D(tVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(v, 0.0, 1.0);
}
