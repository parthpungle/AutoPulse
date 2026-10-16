// Cheap "iridescent metal" for tiers 0-1: no lights, no environment map.
#include <common>
#include <fog_pars_vertex>

varying vec3 vNormalW;
varying vec3 vViewDirW;
varying float vHeight;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDirW = normalize(cameraPosition - worldPos.xyz);
  vHeight = worldPos.y;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
