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
    readout.textContent = `${s.avgFps.toFixed(0)} fps · p95 ${s.p95Ms.toFixed(1)} ms · tier ${exp.settings.tier} · ${exp.particles.count.toLocaleString()} pts · dpr ${exp.sizes.dpr}`;
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
  sim.add(exp.particles.material.uniforms.uSize, 'value', 0.002, 0.1, 0.001).name('size');

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

  for (const f of [sim, fl, post]) f.close();

  return () => {
    window.clearInterval(timer);
    readout.remove();
    gui.destroy();
  };
}
