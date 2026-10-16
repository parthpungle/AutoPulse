// One shader for all eight sensor cards (uSensor picks the artwork):
//  1. frosted glass: the scene behind (backdrop + crank + particles, half-res) sampled at a
//     screen-space offset (fake refraction) with a small blur that widens for neighbours
//  2. fresnel rim along the rounded edge, with a slight RGB split
//  3. live signal artwork, painted as soft ink clouds in the sensor colour (sampled from the
//     card's own small art texture, see cardArt.frag.glsl)
//  4. grain and a faint scanline
// Expanded (uExpand -> 1, the detail view) the same glass turns a little more opaque and more
// frosted, so the HTML content on it reads clearly: wider blur, bright spots behind it clamped,
// refraction 40% weaker, art down to 10% (25% in the band behind the title).
// Reading scrim: every card face is tinted toward uScrim (#0A0B18) under the art, rim and grain:
// 0.35 on the compact cards (titles read even with the crank behind), 0.60 -> 0.72 down the
// expanded card (darkest behind the trace, pills and details).
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
uniform float uExpand;   // 0..1
uniform vec3 uScrim;     // reading scrim colour
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
  vec2 off = (vObjNormal.xy * 0.03 + (vCard - 0.5) * 0.02 + k * 0.012) * uRefract * mix(1.0, 0.6, uExpand);
  float r = mix(mix(1.5, 5.0, uLod), 9.0, uExpand);
  vec2 dx = uGlassTexel * r;
  vec3 g = texture2D(tGlass, suv + off).rgb * 0.36;
  g += texture2D(tGlass, suv + off + vec2(dx.x, dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(-dx.x, dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(dx.x, -dx.y)).rgb * 0.16;
  g += texture2D(tGlass, suv + off + vec2(-dx.x, -dx.y)).rgb * 0.16;
  if (uExpand > 0.0) {
    // a second ring of taps for a smoother frost (only the expanded card pays for it)
    vec2 dy = uGlassTexel * r * 0.55;
    vec3 g2 = texture2D(tGlass, suv + off + vec2(dy.x, 0.0)).rgb;
    g2 += texture2D(tGlass, suv + off + vec2(-dy.x, 0.0)).rgb;
    g2 += texture2D(tGlass, suv + off + vec2(0.0, dy.y)).rgb;
    g2 += texture2D(tGlass, suv + off + vec2(0.0, -dy.y)).rgb;
    g = mix(g, g * 0.6 + g2 * 0.1, uExpand);
  }
  // expanded: a bright spot behind the glass (a sensor tip, a dense flow) can't punch through the
  // scrim; its luminance is soft-clamped first
  float gLum = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g *= mix(1.0, min(1.0, 0.3 / max(gLum, 0.3)), uExpand);
  vec3 col = g * mix(0.62, 0.42, uActive) + vec3(0.010, 0.010, 0.018) + uColor * mix(0.012, 0.022, uExpand);

  // reading scrim (inside the card's shape; the rim and grain go on top)
  float scrim = mix(0.35, mix(0.60, 0.72, smoothstep(0.55, 0.45, vCard.y)), uExpand);
  col = mix(col, uScrim, scrim * front);

  // art over the scrim; it fades early in the expansion, so it is never seen stretched at full
  // strength, and settles at 10% behind the text, 25% in the band behind the title
  float titleBand = smoothstep(0.76, 0.84, vCard.y);
  float ex = smoothstep(0.0, 0.45, uExpand);
  float artK = mix(1.0, mix(0.10, 0.25, titleBand), ex);
  // the art is painted in HDR (glowing strokes well above 1): compress it on the expanded card so
  // 10% stays 10% of a soft image, not of a bright line
  vec3 artC = art / (1.0 + dot(art, vec3(0.2126, 0.7152, 0.0722)) * ex);
  col += artC * mix(0.45, 1.0, uActive) * (1.0 - 0.45 * uLod) * artK;

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

  // expanded, the card is fully opaque: its glass is the blurred, clamped copy above, and even 3%
  // of the HDR scene behind (additive particles, the lit crank) would show through the text
  float a = clamp(mix(0.9, 1.0, uExpand) + side * 0.1, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(max(col, 0.0) * a, a);
}
