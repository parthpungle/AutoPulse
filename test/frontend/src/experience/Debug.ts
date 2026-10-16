import type { DataTexture } from 'three';
import { SENSORS } from '../content/sensors';
import { CAROUSEL, SHOWCASE } from './carousel/CarouselLayout';
import { FLOW } from './sim/Flows';
import type { Experience } from './Experience';
import type { EngineState } from './States';
import type { Tier } from './Quality';

/** Tuning panel behind ?debug. lil-gui is loaded on demand, so it never ships in the main chunk. */
export async function mountDebug(exp: Experience): Promise<() => void> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'TorqueTwin · debug', width: 300 });

  const readout = document.createElement('div');
  readout.className = 'tt-debug-fps';
  document.body.appendChild(readout);
  const timer = window.setInterval(() => {
    const s = exp.perf.stats(120);
    readout.textContent = `${s.avgFps.toFixed(0)} fps · p95 ${s.p95Ms.toFixed(1)} ms · tier ${exp.settings.tier} · ${exp.main.count.toLocaleString()} pts · dpr ${exp.sizes.dpr}`;
  }, 250);

  const q = { tier: exp.settings.tier as number, state: exp.state as EngineState, autoDrop: true };
  const g0 = gui.addFolder('Quality');
  g0.add(q, 'tier', [0, 1, 2, 3]).onChange((t: number) => exp.setTier(t as Tier));
  g0.add(q, 'autoDrop').onChange((v: boolean) => (exp.perf.enabled = v));

  const st = gui.addFolder('Engine state');
  st.add(q, 'state', ['baseline', 'healthy', 'knock', 'misfire', 'valve']).onChange((v: EngineState) => exp.setState(v));
  st.add(exp.shared.uBeat, 'value', 0.5, 4, 0.01).name('beats / s').listen();

  const sim = gui.addFolder('Particles');
  const sp = exp.sim.params;
  sim.add(sp, 'spring', 0, 30, 0.1);
  sim.add(sp, 'damping', 0, 12, 0.1);
  sim.add(sp, 'curlAmp', 0, 3, 0.01);
  sim.add(sp, 'curlFreq', 0.02, 2, 0.01);
  sim.add(sp, 'curlSpeed', 0, 1, 0.01);
  sim.add(sp, 'fluidAmp', 0, 10, 0.1);
  sim.add(exp.params, 'alpha', 0, 2, 0.01);
  sim.add(exp.main.material.uniforms.uSize, 'value', 0.002, 0.1, 0.001).name('size');

  const fl = gui.addFolder('Fluid');
  const fp = exp.fluid.params;
  fl.add(fp, 'dissipation', 0, 5, 0.01);
  fl.add(fp, 'vorticity', 0, 60, 0.5);
  fl.add(fp, 'pressureDecay', 0, 1, 0.01);
  fl.add(fp, 'iterations', 1, 30, 1);
  fl.add(fp, 'splatRadius', 0.0002, 0.02, 0.0001);
  fl.add(fp, 'splatForce', 0, 20000, 10);

  const post = gui.addFolder('Post');
  const pp = exp.composite.params;
  post.add(pp, 'bloomIntensity', 0, 4, 0.01);
  post.add(pp, 'bloomThreshold', 0, 1.5, 0.01);
  post.add(pp, 'bloomRadius', 0, 1, 0.01);
  post.add(pp, 'caBase', 0, 0.004, 0.00005);
  post.add(pp, 'caMax', 0, 0.01, 0.0001);
  post.add(pp, 'grain', 0, 0.2, 0.001);
  post.add(pp, 'vignette', 0, 1, 0.01);

  const sa = gui.addFolder('Sensor array');
  sa.add(CAROUSEL, 'drop', 0, 2, 0.01).name('helix spacing');
  sa.add(CAROUSEL, 'camRadius', 5, 14, 0.05).name('camera radius');
  sa.add(exp.cards.params, 'tilt', 0, 20, 0.5).name('card tilt (deg)');
  sa.add(exp.cards.params, 'refraction', 0, 4, 0.01).name('glass refraction');

  const fs = gui.addFolder('Flows & Showcase');
  const W = SHOWCASE.wide;
  fs.add(W.spot, 'x', 0, 1, 0.01).name('spot x');
  fs.add(W.spot, 'y', 0, 1, 0.01).name('spot y');
  fs.add(W.spot, 'h', 0.1, 0.6, 0.01).name('spot height');
  fs.add(SHOWCASE, 'spotDist', 2, 9, 0.05).name('spot distance');
  fs.add(W.card, 'x', 0, 1, 0.01).name('card x');
  fs.add(W.card, 'w', 0.15, 0.6, 0.01).name('card width');
  fs.add(W.stack, 'y', 0, 0.6, 0.01).name('card stack spacing');
  fs.add(exp.rig.key, 'intensity', 0, 8, 0.05).name('key light');
  fs.add(exp.rig.fill, 'intensity', 0, 4, 0.05).name('fill light');
  fs.add(exp.rig.lightParams, 'rimIntensity', 0, 60, 0.5).name('rim light');
  fs.add(exp.rig.lightParams, 'crankDim', 0.2, 1, 0.01).name('crank brightness');
  fs.add(exp.flows, 'speedScale', 0, 3, 0.01).name('flow speed');
  fs.add(exp.sim.uniforms.uFlowDensity, 'value', 0, 1, 0.01).name('flow density');
  for (let i = 0; i < 8; i++) fs.add(FLOW.speed as unknown as Record<string, number>, String(i), 0, 1.5, 0.01).name(`speed: ${SENSORS[i].indexLabel}`);
  fs.add(FLOW, 'data', 0, 1.5, 0.01).name('speed: data dashes');
  // read-only: what the flows are doing right now
  const live = { arrival: 0, rowsRebuilt: 0, pools: poolShares(exp) };
  fs.add(live, 'arrival', 0, 1).name('tip arrival').listen().disable();
  fs.add(live, 'rowsRebuilt', 0, 16, 1).name('path rows rebuilt').listen().disable();
  fs.add(live, 'pools').name('dust / trickle / flow / data').disable();
  const liveTimer = window.setInterval(() => {
    live.arrival = exp.flows.arrival;
    live.rowsRebuilt = exp.paths.rebuilt;
  }, 100);

  const atm = gui.addFolder('Atmosphere');
  const hv = exp.backdrop.hazeViolet;
  const ht = exp.backdrop.hazeTeal;
  atm.add(hv, 'x', 0, 1, 0.01).name('violet x');
  atm.add(hv, 'y', 0, 1, 0.01).name('violet y');
  atm.add(hv, 'z', 0.1, 2, 0.01).name('violet radius');
  atm.add(hv, 'w', 0, 1, 0.01).name('violet strength');
  atm.add(ht, 'x', 0, 1, 0.01).name('teal x');
  atm.add(ht, 'y', 0, 1, 0.01).name('teal y');
  atm.add(ht, 'z', 0.1, 2, 0.01).name('teal radius');
  atm.add(ht, 'w', 0, 1, 0.01).name('teal strength');
  const bu = exp.backdrop.material.uniforms;
  atm.addColor(bu.uViolet, 'value').name('violet colour');
  atm.addColor(bu.uTeal, 'value').name('teal colour');
  atm.add(bu.uBand, 'value', 0, 3, 0.01).name('fog band');

  for (const f of [sim, fl, post, atm]) f.close();

  return () => {
    window.clearInterval(timer);
    window.clearInterval(liveTimer);
    readout.remove();
    gui.destroy();
  };
}

/** Particles drawn per Sensor Array pool at the current tier: dust / trickles / active flow / data. */
export function poolShares(exp: Experience) {
  const d = (exp.main.material.uniforms.tStreams.value as DataTexture).image.data as unknown as Float32Array;
  const c = [0, 0, 0, 0];
  for (let i = 0; i < exp.main.count; i++) {
    const x = d[i * 4];
    if (x < 9) c[0]++;
    else if (x < 19) c[1]++;
    else if (x < 29) c[2]++;
    else c[3]++;
  }
  return c.map((v) => v.toLocaleString('en-US')).join(' / ');
}
