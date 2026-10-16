// Soft round sprite drawn analytically (no texture), blended additively.
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float f = 1.0 - d;
  gl_FragColor = vec4(vColor * f * f, 1.0);
}
