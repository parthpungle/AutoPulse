uniform sampler2D tPos;
uniform sampler2D tVel;
uniform vec2 uRes;
uniform float uDt;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 p = texture2D(tPos, uv).xyz + texture2D(tVel, uv).xyz * uDt;
  // a lost particle (NaN, or thrown far away) restarts at the origin and springs home
  if (any(isnan(p)) || dot(p, p) > 2500.0) p = vec3(0.0);
  gl_FragColor = vec4(p, 1.0);
}
