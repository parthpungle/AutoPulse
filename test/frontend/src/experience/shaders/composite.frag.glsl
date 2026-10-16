// Lays the section worlds over the backdrop: bd * (1 - a) + rgb (solids carry coverage in alpha,
// particles are added light). Between two sections the screen is cut by one tilted seam (see
// seam/Seam.ts): the incoming world below it, the outgoing world above, both live. In a band
// right above the seam the outgoing world tears into horizontal strips that shift sideways, break
// into blocks and split their colours, and a few strips show the incoming world instead. The
// strip table comes from the CPU so the DOM clip polygons cut exactly the same strips.
// Reduced motion crossfades instead. The intro wipe is drawn here too.
uniform sampler2D tBackdrop;
uniform sampler2D tFrom;      // the current (outgoing) world
uniform sampler2D tTo;        // the incoming world
uniform float uCut;           // 1 while a seam is on screen
uniform vec2 uSeam;           // seam height (UV, from the bottom) at the left and right edges
uniform float uBand;          // torn band height (UV)
uniform vec4 uStrips[16];     // per strip: top above the seam (UV), shift (UV x), bleed (0/1), RGB split (UV x)
uniform float uStripCount;
uniform float uMosaic;        // block width in shifted strips (UV x)
uniform float uCross;         // reduced motion: crossfade from -> to (0..1), < 0 when unused
uniform float uReveal;
uniform float uFadeReveal;    // reduced motion: plain fade instead of the intro wipe
uniform float uFlash;
uniform float uTime;
uniform float uAspect;
uniform vec3 uBg;
uniform vec3 uAccent;
varying vec2 vUv;

vec4 torn(vec2 uv) {
  float d = uv.y - mix(uSeam.x, uSeam.y, uv.x); // > 0 above the seam
  if (d <= 0.0) return texture2D(tTo, uv);
  if (d >= uBand) return texture2D(tFrom, uv);
  vec4 st = vec4(0.0);
  for (int k = 0; k < 16; k++) {
    if (float(k) >= uStripCount) break;
    if (d < uStrips[k].x) {
      st = uStrips[k];
      break;
    }
  }
  vec2 p = uv + vec2(st.y, 0.0);
  if (st.z > 0.5) return texture2D(tTo, p);
  // shifted strips break into blocks, like the reference's chopped letters
  if (st.y != 0.0) p.x = (floor(p.x / uMosaic) + 0.5) * uMosaic;
  vec4 c = texture2D(tFrom, p);
  if (st.w > 0.0) {
    c.r = texture2D(tFrom, p + vec2(st.w, 0.0)).r;
    c.b = texture2D(tFrom, p - vec2(st.w, 0.0)).b;
  }
  return c;
}

void main() {
  vec3 bd = texture2D(tBackdrop, vUv).rgb;
  vec4 S;
  if (uCross >= 0.0) S = mix(texture2D(tFrom, vUv), texture2D(tTo, vUv), uCross);
  else if (uCut > 0.5) S = torn(vUv);
  else S = texture2D(tFrom, vUv);
  vec3 col = bd * (1.0 - clamp(S.a, 0.0, 1.0)) + S.rgb;
  vec2 dir = vUv - 0.5;
  col += uAccent * uFlash * 0.04 * (1.0 - smoothstep(0.0, 0.8, length(dir)));

  if (uReveal < 1.0) {
    if (uFadeReveal > 0.5) {
      col = mix(uBg, col, uReveal);
    } else {
      float n = snoise(vec3(vUv.x * uAspect * 2.2, vUv.y * 2.2, uTime * 0.15)) * 0.06;
      float e = vUv.x * 0.62 + (1.0 - vUv.y) * 0.38 + n;
      float r = uReveal * 1.3 - 0.15;
      float hidden = smoothstep(r - 0.015, r + 0.015, e);
      float line = gauss((e - r) / 0.006) * step(0.0001, uReveal);
      col = mix(col, uBg, hidden) + uAccent * line * 1.4;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
