// Vorticity confinement: puts back the small swirls that the coarse grid smooths away.
uniform sampler2D tVelocity;
uniform sampler2D tCurl;
uniform float uCurl;
uniform float uDt;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(tCurl, vL).x;
  float R = texture2D(tCurl, vR).x;
  float T = texture2D(tCurl, vT).x;
  float B = texture2D(tCurl, vB).x;
  float C = texture2D(tCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurl * C;
  force.y *= -1.0;
  vec2 v = texture2D(tVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}
