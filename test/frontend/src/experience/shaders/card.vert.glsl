uniform vec2 uSize; // current card width, height (world units), including uGrow
uniform vec2 uGrow; // extra width, height while expanding (the slab is built at its resting size)

varying vec2 vCard;       // 0..1 across the card face
varying vec3 vObjNormal;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec4 vClip;

void main() {
  // resize without stretching the corners: every vertex of the rounded rectangle lies on a
  // corner arc (or its bevel), so it moves out with its quadrant and the radius is kept
  vec3 p = position;
  p.xy += sign(p.xy) * uGrow * 0.5;
  vCard = p.xy / uSize + 0.5;
  vObjNormal = normal;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = cameraPosition - wp.xyz;
  vClip = projectionMatrix * viewMatrix * wp;
  gl_Position = vClip;
}
