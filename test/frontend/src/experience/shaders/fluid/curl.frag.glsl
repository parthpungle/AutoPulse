uniform sampler2D tVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(tVelocity, vL).y;
  float R = texture2D(tVelocity, vR).y;
  float T = texture2D(tVelocity, vT).x;
  float B = texture2D(tVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
