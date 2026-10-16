import { getGPUTier } from 'detect-gpu';
import type { WebGLRenderer } from 'three';

/** Applied on top of every tier's base count: one knob for overall particle density. */
export const PARTICLE_SCALE = 0.7;

export type Tier = 0 | 1 | 2 | 3;

export interface TierSettings {
  tier: Tier;
  /** Particles actually drawn. */
  count: number;
  /** Side of the square simulation textures (ceil of the square root of count). */
  side: number;
  fluidRes: number;
  jacobi: number;
  dprCap: number;
  bloom: boolean;
}

const BASE_SIDE = [96, 128, 192, 256];
const FLUID_RES = [64, 96, 128, 128];
const JACOBI = [6, 6, 8, 10];
const DPR_CAP = [1, 1.25, 1.5, 2];

export function tierSettings(tier: Tier): TierSettings {
  const count = Math.floor(BASE_SIDE[tier] * BASE_SIDE[tier] * PARTICLE_SCALE);
  return {
    tier,
    count,
    side: Math.ceil(Math.sqrt(count)),
    fluidRes: FLUID_RES[tier],
    jacobi: JACOBI[tier],
    dprCap: DPR_CAP[tier],
    bloom: tier > 0,
  };
}

// detect-gpu's benchmark tables ship inside the package; load them from the bundle instead of
// unpkg so tier detection works offline (venue Wi-Fi).
const BENCHMARKS = import.meta.glob<unknown[]>('/node_modules/detect-gpu/dist/benchmarks/*.json', {
  import: 'default',
  exhaustive: true,
});

async function loadBenchmarks(file: string) {
  const key = Object.keys(BENCHMARKS).find((k) => k.endsWith(`/${file}`));
  if (!key) throw new Error(`no GPU benchmark ${file}`);
  // detect-gpu's ModelEntry tuple type isn't exported; the JSON is exactly that shape
  return (await BENCHMARKS[key]()) as never;
}

export interface QualityResult {
  tier: Tier;
  gpu: string;
  mobile: boolean;
  source: string;
}

export async function detectQuality(renderer: WebGLRenderer): Promise<QualityResult> {
  const forced = new URLSearchParams(location.search).get('tier');
  const mobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  if (forced !== null && /^[0-3]$/.test(forced)) {
    return { tier: Number(forced) as Tier, gpu: 'forced', mobile, source: '?tier' };
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  try {
    // detect-gpu gets its own throwaway context: on iOS it draws a probe triangle to tell Apple GPUs
    // apart (clearColor 1,1,1,1, its own viewport and program), which would desync three's GL state.
    // The context is released right after, rather than lingering until garbage collection.
    const probe = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' });
    const r = await Promise.race([getGPUTier({ glContext: probe ?? undefined, override: { loadBenchmarks } }), timeout]);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    renderer.resetState();
    if (!r) return { tier: 2, gpu: 'unknown', mobile, source: 'timeout' };
    // detect-gpu's tier 0 means "blocklisted or too slow"; we still render, at our lowest tier
    let tier = Math.max(0, Math.min(3, r.tier)) as Tier;
    if (r.type === 'FALLBACK') tier = 2;
    // phones render at tier 1 at most (Sensor Array budget)
    if (r.isMobile || mobile) tier = Math.min(tier, 1) as Tier;
    return { tier, gpu: r.gpu ?? 'unknown', mobile: !!r.isMobile || mobile, source: r.type };
  } catch {
    return { tier: 2, gpu: 'unknown', mobile, source: 'error' };
  }
}
