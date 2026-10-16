// One Jacobi iteration of the pressure Poisson equation (Harris, GPU Gems ch. 38).
uniform sampler2D tPressure;
uniform sampler2D tDivergence;
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
  float div = texture2D(tDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
