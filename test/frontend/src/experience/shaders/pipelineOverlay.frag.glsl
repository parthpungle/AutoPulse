// The thin lines of the signal pipeline, drawn as analytic shapes on one quad (a line primitive is
// one device pixel, too thin): the clock line (INGEST), the sliding window and its overlap
// brackets (WINDOW), the knock-band bracket (TRANSFORM) and the bars' baseline (FINGERPRINT).
// Geometry comes from pipeline.glsl, so everything sits where its particles are. Additive light.
uniform float uTime;
uniform float uStage;
uniform float uKnock;
uniform float uOpacity;
varying vec2 vWorld;

// distance to an axis-aligned box outline, and a filled-box mask
float boxEdge(vec2 p, vec2 lo, vec2 hi) {
  vec2 c = 0.5 * (lo + hi);
  vec2 q = abs(p - c) - 0.5 * (hi - lo);
  return abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
}
float line(float d, float w) { return exp(-pow(d / w, 2.0)); }
float stageAt(float s, float lo, float hi) { return smoothstep(lo - 0.5, lo, s) * (1.0 - smoothstep(hi, hi + 0.5, s)); }

void main() {
  float W = uL2.y;
  float H = uL2.z;
  vec2 p = vWorld;
  float px = 0.0035 * W; // a line's half width
  vec3 col = vec3(0.0);
  float fx = (p.x - (uL2.x - 0.5 * W)) / W;  // 0..1 across the region
  float fy = (p.y - uL2.w) / H;              // 0..1 up the region

  // INGEST: the clock line sweeping across the lanes, with a faint glow behind it
  float s0 = 1.0 - smoothstep(0.35, 1.0, uStage);
  float cx = pipeClock(uTime);
  float clk = line(fx - cx, 0.004) * 1.6 + (1.0 - smoothstep(0.0, 0.18, cx - fx)) * step(fx, cx) * 0.06;
  col += vec3(0.62, 0.8, 0.92) * clk * s0 * step(0.1, fy) * step(fy, 1.0);

  // WINDOW: a translucent frame over the lanes and, beneath them, the packets as two rows of
  // overlapping brackets (even packets above, odd ones below), so the 50% overlap reads
  float s1 = stageAt(uStage, 1.0, 1.0);
  float w0 = pipeWindow(uTime);
  vec2 lo = vec2(w0, 0.1);
  vec2 hi = vec2(w0 + PIPE_WIN, 1.0);
  float frame = line(boxEdge(vec2(fx, fy), lo, hi) * W, px) * 0.9;
  float fill = step(lo.x, fx) * step(fx, hi.x) * step(lo.y, fy) * step(fy, hi.y) * 0.035;
  col += vec3(0.8, 0.9, 1.0) * (frame + fill) * s1;
  for (int row = 0; row < 2; row++) {
    float bk = floor((fx - float(row) * PIPE_PACKET * 0.5) / PIPE_PACKET);
    float a = bk * PIPE_PACKET + float(row) * PIPE_PACKET * 0.5 + 0.004;
    float b = a + PIPE_PACKET - 0.008;
    float yb = 0.062 - float(row) * 0.034;
    float inWin = step(w0, a) * step(b, w0 + PIPE_WIN + 0.0001);
    float seg = line((fy - yb) * H, px) * step(a, fx) * step(fx, b);
    float tick = line((fx - a) * W, px) * step(abs(fy - yb), 0.012) + line((fx - b) * W, px) * step(abs(fy - yb), 0.012);
    col += mix(vec3(0.45, 0.6, 0.8), vec3(1.0), inWin) * (seg + tick) * (0.4 + 0.6 * inWin) * s1 * step(fx, 0.97);
  }

  // TRANSFORM: an orange bracket around the knock band (5.5-8 kHz) of the wall; it lights and
  // pulses while the engine state is Knock
  float s2 = stageAt(uStage, 2.0, 2.0);
  float wy0 = PIPE_WALL_LO + KNOCK_LO * (PIPE_WALL_HI - PIPE_WALL_LO);
  float wy1 = PIPE_WALL_LO + KNOCK_HI * (PIPE_WALL_HI - PIPE_WALL_LO);
  float bx0 = PIPE_WALL0 - 0.012;
  float bx1 = PIPE_WALL1 + 0.012;
  float edge = line(boxEdge(vec2(fx, fy), vec2(bx0, wy0), vec2(bx1, wy1)) * W, px);
  // a bracket, not a full rectangle: the corners and the left bar only
  float corner = step(abs(fx - bx0), 0.02) + step(abs(fy - wy0), 0.012) + step(abs(fy - wy1), 0.012);
  float pulse = 0.35 + uKnock * (0.9 + 0.35 * sin(uTime * 9.0));
  col += vec3(0.9, 0.5, 0.28) * edge * min(corner, 1.0) * pulse * s2;

  // FINGERPRINT: the baseline under the 28 bars
  float s3 = smoothstep(2.4, 3.0, uStage);
  float base = line((fy - PIPE_WALL_LO) * H, px) * step(0.18, fx) * step(fx, 0.82);
  col += vec3(0.7, 0.8, 1.0) * base * 0.45 * s3;

  gl_FragColor = vec4(col * uOpacity, 0.0);
}
