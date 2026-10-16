// Puts a section's particles straight onto their home shape (used once at load for every section
// but the hero, whose particles burst out of the spawn seed). Same uniforms as velocity.frag.
uniform sampler2D tParams;
uniform vec2 uRes;
uniform float uSection;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  gl_FragColor = vec4(shape(uSection, texture2D(tParams, uv), uTime).xyz, 1.0);
}
