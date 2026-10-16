// Damps last frame's pressure, which seeds the Jacobi solve.
uniform sampler2D tSource;
uniform float uScale;
varying vec2 vUv;

void main() {
  gl_FragColor = uScale * texture2D(tSource, vUv);
}
