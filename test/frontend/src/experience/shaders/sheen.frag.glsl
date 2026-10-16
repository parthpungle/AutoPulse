// Fakes thin-film sheen with a fresnel term and a three-colour gradient (violet, teal, magenta)
// indexed by view angle and height, over a dark metal base. Fog-aware.
#include <common>
#include <fog_pars_fragment>

uniform vec3 uBase;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uDim;      // 0..1 brightness (inactive sensors dim)
uniform vec3 uRim;       // rim light colour (active sensor)
uniform float uRimAmt;

varying vec3 vNormalW;
varying vec3 vViewDirW;
varying float vHeight;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(vViewDirW);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  float k = fract(ndv * 1.3 + vHeight * 0.08 + n.y * 0.25);
  vec3 film = k < 0.5 ? mix(uA, uB, k * 2.0) : mix(uB, uC, (k - 0.5) * 2.0);
  // a soft key from above so the shape reads
  float key = 0.35 + 0.65 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = uBase * key + film * (0.18 + 0.9 * fres);
  col += uRim * uRimAmt * fres * 1.5;
  gl_FragColor = vec4(col * uDim, 1.0);
  #include <fog_fragment>
}
