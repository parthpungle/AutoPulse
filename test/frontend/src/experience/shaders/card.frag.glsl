// One shader for all eight sensor cards (uSensor picks the artwork):
//  1. frosted glass: the scene behind (backdrop + crank + particles, half-res) sampled at a
//     screen-space offset (fake refraction) with a small blur that widens for neighbours
//  2. fresnel rim along the rounded edge, with a slight RGB split
//  3. live signal artwork, painted as soft ink clouds in the sensor colour (sampled from the
//     card's own small art texture, see cardArt.frag.glsl)
//  4. grain and a faint scanline
// Output is premultiplied (the main layer composites as bd * (1 - a) + rgb).
uniform float uTime;
uniform sampler2D tGlass;
uniform vec2 uGlassTexel;
uniform vec2 uSize;
uniform float uSensor;
uniform float uActive;   // 0..1
uniform float uLod;      // 0 sharp .. 1 blurred (neighbours)
uniform float uHover;    // 0..1
uniform float uOpacity;
uniform float uRefract;
uniform vec3 uColor;
uniform sampler2D tArt;  // this card's artwork (rgb) and ink field (a), painted by cardArt.frag

varying vec2 vCard;
varying vec3 vObjNormal;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec4 vClip;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(vViewW);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float side = 1.0 - abs(vObjNormal.z);
  // the painted artwork (mirrored automatically when the card is seen from behind)
  vec4 A = texture2D(tArt, vCard);
  // the back of a card is plain frosted glass: never show its front content mirrored
  float front = step(-0.5, vObjNormal.z);
  vec3 art = A.rgb * front;
  float k = (A.a * 2.0 - 1.0) * front;

  // frosted glass: refracted, blurred view of what is behind the card
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  vec2 off = (vObjNormal.xy * 0.03 + (vCard - 0.5) * 0.02 + k * 0.012) * uRefract;
  float r = mix(1.5, 5.0, uLod);
  vec2 dx = uGlassTexel * r;
  vec3 g = texture2D(tGlass, suv + off).rgb * 0.36;
  g += texture2D(tGlass, suv + off + vec2(dx.x, dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(-dx.x, dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(dx.x, -dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(-dx.x, -dx.y)).rgb * 0.16;
  vec3 col = g * mix(0.62, 0.42, uActive) + vec3(0.010, 0.010, 0.018) + uColor * 0.012;
  col += art * mix(0.45, 1.0, uActive) * (1.0 - 0.45 * uLod);

  // rim: the rounded-rect border, with a slight RGB split, plus fresnel
  vec2 q = abs(vCard - 0.5) * uSize - (uSize * 0.5 - 0.16);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.16;
  float rimG = smoothstep(-0.045, 0.0, sd);
  float rimR = smoothstep(-0.045, 0.0, sd + 0.007);
  float rimB = smoothstep(-0.045, 0.0, sd - 0.007);
  vec3 rimTint = mix(uColor, vec3(1.0), 0.45);
  float rimAmt = 0.25 + 0.45 * uHover + 0.35 * uActive;
  col += vec3(rimR, rimG, rimB) * rimTint * rimAmt;
  float fres = pow(1.0 - ndv, 2.5);
  col += uColor * fres * 0.35 + side * rimTint * (0.35 + 0.4 * uActive);

  // grain and scanline
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * 0.02;
  col *= 0.97 + 0.03 * sin(vCard.y * uSize.y * 240.0);

  float a = clamp(0.9 + side * 0.1, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(max(col, 0.0) * a, a);
}
