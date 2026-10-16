uniform vec2 uSize; // card width, height (world units)

varying vec2 vCard;       // 0..1 across the card face
varying vec3 vObjNormal;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec4 vClip;

void main() {
  vCard = position.xy / uSize + 0.5;
  vObjNormal = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = cameraPosition - wp.xyz;
  vClip = projectionMatrix * viewMatrix * wp;
  gl_Position = vClip;
}
