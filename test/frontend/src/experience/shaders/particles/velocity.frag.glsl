// Particle velocity: spring toward its section's home shape + fluid drag + curl noise + engine
// state. Every section owns a block of rows (sim/Ranges.ts) and is simulated in its own scissored
// pass, so uSection is the same for every fragment of a draw.
// Written to RGBA: xyz = velocity (world units / s), w = emphasis read by the draw pass.
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tRand;
uniform sampler2D tParams;
uniform sampler2D tFluid;
uniform vec2 uRes;
uniform float uSection;
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

  vec4 home = shape(uSection, texture2D(tParams, uv), uTime);
  // Sensor Array flows track their paths (see shapes.glsl)
  float flow = gFlow;
  // Recognition clusters keep their own motion: the global engine state (knock kicks, valve
  // jitter, misfire stalls) never touches them
  float global = abs(uSection - 3.0) < 0.5 ? 0.0 : 1.0;
  // the intro holds only the hero's particles at the spawn point
  float intro = uSection < 0.5 ? uIntro : 1.0;

  if (uReduced > 0.5) {
    // no flight: ease straight to home
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

  vec3 acc = (home.xyz - pos) * uSpring * intro;

  vec3 cn = curlNoise(pos * uCurlFreq + vec3(0.0, 0.0, uTime * uCurlSpeed));
  acc += cn * uCurlAmp * uTurb * (1.0 + 2.0 * (1.0 - intro));
  acc.xy += fv * uFluidAmp;
  acc.z += length(fv) * uFluidAmp * 0.3 * (R.y - 0.5);

  // knock: a sharp kick at every beat
  float kp = knockPulse(uTime);
  vec3 kdir = normalize(vec3((R.z - 0.5) * 0.6, (R.w - 0.5) + sign(R.w - 0.5) * 0.35, (R.x - 0.5) * 0.6));
  acc += kdir * kp * 110.0 * global;
  // valve wear: high-frequency jitter
  acc += (hash33(vec3(gl_FragCoord.xy, floor(uTime * 60.0))) - 0.5) * uValve * 110.0 * global;
  // misfire: a slice of particles stalls every 4th beat
  float stall = misfireStall(R.y, uTime) * global;
  acc *= 1.0 - stall;

  vel += acc * uDt;
  vel *= exp(-(uDamping + stall * 14.0) * uDt);
  gl_FragColor = vec4(vel, home.w);
}
