// Engine-state signals shared by the particle simulation and the particle draw, so both
// agree on every beat without any per-beat work on the CPU.
uniform float uTime;
uniform float uBeat;      // engine beats per second
uniform float uTurb;      // turbulence multiplier
uniform float uKnock;     // 0..1
uniform float uMisfire;   // 0..1
uniform float uValve;     // 0..1
uniform vec4 uStateW;     // highlight weight per engine state: healthy, knock, misfire, valve wear
uniform vec4 uClusterSel; // Recognition selection per cluster (only styles the clusters)
uniform float uAnySel;    // 1 while a cluster is selected

float beatPhase(float t) { return fract(t * uBeat); }

// Sharp impulse at the start of every beat.
float knockPulse(float t) { return uKnock * exp(-beatPhase(t) * 28.0); }

// Every 4th beat, the slice of particles with r < 0.25 stops firing.
float misfireStall(float r, float t) {
  float cycle = floor(t * uBeat);
  return uMisfire * step(r, 0.25) * step(3.0, mod(cycle, 4.0));
}
