uniform sampler2D tSource;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(tSource, vUv);
}
