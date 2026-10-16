// Particle velocity: spring toward the morphing home shape + fluid drag + curl noise + engine state.
// Written to RGBA: xyz = velocity (world units / s), w = emphasis read by the draw pass.
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tRand;
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tFluid;
uniform vec2 uRes;
uniform float uSecA;
uniform float uSecB;
uniform float uMorph;
uniform float uDt;
uniform float uSpring;
uniform float uDamping;
uniform float uCurlAmp;
uniform float uCurlFreq;
uniform float uCurlSpeed;
uniform float uFluidAmp;
uniform vec2 uFluidScale;   // fluid texels / s -> world units / s
uniform float uIntro;       // 0 = held at the spawn point, 1 = free
uniform float uReduced;
uniform mat4 uViewProj;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 pos = texture2D(tPos, uv).xyz;
  vec3 vel = texture2D(tVel, uv).xyz;
  vec4 R = texture2D(tRand, uv);

  // staggered morph: each particle starts and lands a little apart, so shapes travel in waves
  float m = uReduced > 0.5 ? step(0.5, uMorph) : smoothstep(R.x * 0.4, 0.6 + R.x * 0.4, uMorph);
  vec4 home = shape(uSecA, texture2D(tA, uv), uTime);
  if (m > 0.0) home = mix(home, shape(uSecB, texture2D(tB, uv), uTime), m);
  // how much of this particle's home is a Sensor Array flow (see shapes.glsl)
  float flow = gFlow * ((abs(uSecA - 1.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 1.0) < 0.5 ? m : 0.0)
                      + (abs(uSecA - 2.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 2.0) < 0.5 ? m : 0.0));
  // and how much is a Recognition cluster: clusters keep their own motion, the global engine state
  // (knock kicks, valve jitter, misfire stalls) never touches them
  float w3 = (abs(uSecA - 3.0) < 0.5 ? 1.0 - m : 0.0) + (abs(uSecB - 3.0) < 0.5 ? m : 0.0);
  float global = 1.0 - w3;

  if (uReduced > 0.5) {
    // no flight: ease straight to home (the draw pass fades through dark between sections)
    vel = (home.xyz - pos) * min(uDt * 8.0, 1.0) / max(uDt, 1e-4);
    gl_FragColor = vec4(vel, home.w);
    return;
  }

  // drag along the fluid under the cursor (the solver runs in screen space)
  vec4 clip = uViewProj * vec4(pos, 1.0);
  vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
  float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
  vec2 fv = texture2D(tFluid, suv).xy * uFluidScale * inside;

  // Sensor Array flows ride their moving paths without spring lag (the cursor still pushes them),
  // and a particle that has just wrapped jumps back to the start instead of flying back across.
  // Fully on a flow, nothing else applies, so the noise below is skipped (most of the section).
  vec3 track = (home.xyz - pos) * 14.0 + vec3(fv * uFluidAmp * 0.12, 0.0);
  if (gU < 0.04 && distance(home.xyz, pos) > 0.35) track = (home.xyz - pos) / max(uDt, 1e-4);
  if (flow > 0.999) {
    gl_FragColor = vec4(track, home.w);
    return;
  }

  float trans = sin(PI * m);
  vec3 acc = (home.xyz - pos) * uSpring * uIntro * (1.0 - 0.55 * trans);

  vec3 cn = curlNoise(pos * uCurlFreq + vec3(0.0, 0.0, uTime * uCurlSpeed));
  acc += cn * uCurlAmp * uTurb * (1.0 + 2.5 * trans + 2.0 * (1.0 - uIntro));
  acc.xy += fv * uFluidAmp;
  acc.z += length(fv) * uFluidAmp * 0.3 * (R.y - 0.5);

  // knock: a sharp kick at every beat
  float kp = knockPulse(uTime);
  vec3 kdir = normalize(vec3((R.z - 0.5) * 0.6, (R.w - 0.5) + sign(R.w - 0.5) * 0.35, (R.x - 0.5) * 0.6));
  acc += kdir * kp * 110.0 * global;
  // valve wear: a fine high-frequency shimmer. Small on purpose: this is random acceleration every
  // frame, so at 110 it more than quadrupled the particles' speed instead of shimmering them
  acc += (hash33(vec3(gl_FragCoord.xy, floor(uTime * 60.0))) - 0.5) * uValve * 22.0 * global;
  // misfire: a slice of particles stalls every 4th beat
  float stall = misfireStall(R.y, uTime) * global;
  acc *= 1.0 - stall;

  vel += acc * uDt;
  vel *= exp(-(uDamping + stall * 14.0) * uDt);
  // part-way into a flow (morphing in or out of the section): blend
  if (flow > 0.0) vel = mix(vel, track, flow);
  gl_FragColor = vec4(vel, home.w);
}
