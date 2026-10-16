import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { Material } from 'three';
import { GLSL } from '../shaders';

/**
 * The material library for the crankshaft and the sensor models, so everything reads as real
 * hardware: steel, dark steel, brass, black plastic, rubber cables, a ceramic lambda tip and
 * polished bearing surfaces. Thin-film colour survives only as a subtle fresnel sheen on edges
 * (one onBeforeCompile hook). Tiers 0-1 use a cheap unlit fresnel shader instead (no environment
 * map). Every material carries its base colour and sheen strength in userData so it can be
 * dimmed per object without allocations.
 */
export type MatKey = 'steel' | 'polished' | 'darkSteel' | 'brass' | 'blackPlastic' | 'rubber' | 'ceramic';
export type Cut = 'none' | 'hex' | 'slots';

interface Spec {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  /** Edge sheen strength. */
  sheen: number;
}

export const SPECS: Record<MatKey, Spec> = {
  steel: { color: '#B8BDC7', metalness: 1, roughness: 0.32, sheen: 0.3 },
  polished: { color: '#CDD2DB', metalness: 1, roughness: 0.16, sheen: 0.3 },
  darkSteel: { color: '#3A3D44', metalness: 1, roughness: 0.45, sheen: 0.22 },
  brass: { color: '#B08D57', metalness: 1, roughness: 0.35, sheen: 0.12 },
  blackPlastic: { color: '#16181C', metalness: 0, roughness: 0.55, clearcoat: 0.3, sheen: 0.08 },
  rubber: { color: '#0E0F12', metalness: 0, roughness: 0.9, sheen: 0 },
  ceramic: { color: '#E6E0D3', metalness: 0, roughness: 0.7, sheen: 0 },
};

/** RoomEnvironment reflections, through PMREM. */
const ENV_INTENSITY = 1.1;

interface MatData {
  base: Color;
  sheen: { value: number };
  sheenBase: number;
  /** Emissive pulse (sensor tips "hearing"). */
  pulse: { value: number };
  pulseColor: { value: Color };
  /** Where the pulse glows (builder space) and how far it reaches; radius 0 lights the whole part. */
  tip: { value: Vector3 };
  tipRadius: { value: number };
}

const SHEEN_PARS = /* glsl */ `
uniform float uEdgeSheen;
uniform float uPulse;
uniform vec3 uPulseColor;
uniform vec3 uTipObj;
uniform float uTipR;
`;
// added to the lit colour: a thin-film-like hue that only shows at grazing angles
const SHEEN_APPLY = /* glsl */ `
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(abs(dot(normal, vdir)), 0.0, 1.0), 4.0);
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (fres * 1.1 + vec3(0.62, 0.86, 0.12)));
  outgoingLight += film * fres * uEdgeSheen;
  float near = uTipR > 0.0 ? smoothstep(uTipR, 0.0, distance(vPObj, uTipObj)) : 1.0;
  outgoingLight += uPulseColor * uPulse * near;
}
`;

function cutCode(cut: Cut) {
  if (cut === 'hex')
    return /* glsl */ `{
      float ang = atan(vPObj.z, vPObj.x);
      float rr = length(vPObj.xz);
      vec2 g = vec2(ang * max(rr, 0.02), vPObj.y) / vec2(0.024, 0.0208);
      float row = floor(g.y);
      g.x += mod(row, 2.0) * 0.5;
      vec2 f = (fract(g) - 0.5) * vec2(0.024, 0.0208);
      if (dot(f, f) < 0.0000475 && vPObj.y < -0.13) discard;
    }`;
  if (cut === 'slots')
    return /* glsl */ `{
      float ang = atan(vPObj.z, vPObj.x);
      float k = fract(ang / 6.2831853 * 8.0);
      if (k > 0.4 && k < 0.6 && vPObj.y > -0.32 && vPObj.y < -0.19) discard;
    }`;
  return '';
}

function makeHigh(key: MatKey, cut: Cut): Material {
  const s = SPECS[key];
  const params = { color: new Color(s.color), metalness: s.metalness, roughness: s.roughness, envMapIntensity: ENV_INTENSITY };
  const m = s.clearcoat ? new MeshPhysicalMaterial({ ...params, clearcoat: s.clearcoat, clearcoatRoughness: 0.4 }) : new MeshStandardMaterial(params);
  if (cut !== 'none') m.side = DoubleSide;
  const data: MatData = { base: params.color.clone(), sheen: { value: s.sheen }, sheenBase: s.sheen, pulse: { value: 0 }, pulseColor: { value: new Color() }, tip: { value: new Vector3() }, tipRadius: { value: 0 } };
  m.userData.tt = data;
  const cutGlsl = cutCode(cut);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEdgeSheen = data.sheen;
    sh.uniforms.uPulse = data.pulse;
    sh.uniforms.uPulseColor = data.pulseColor;
    sh.uniforms.uTipObj = data.tip;
    sh.uniforms.uTipR = data.tipRadius;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPObj;\n' + SHEEN_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + cutGlsl)
      .replace('#include <opaque_fragment>', SHEEN_APPLY + '\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => `tt-hw-${cut}`;
  return m;
}

function makeLow(key: MatKey): Material {
  const s = SPECS[key];
  const base = new Color(s.color);
  // the unlit fake needs a little help on near-black parts so their silhouettes still read
  const shown = s.metalness > 0.5 ? base.clone().multiplyScalar(0.45) : base.clone().lerp(new Color('#2A2D36'), 0.35);
  const m = new ShaderMaterial({
    vertexShader: GLSL.sheenVert,
    fragmentShader: GLSL.sheenFrag,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBase: { value: shown },
        uA: { value: new Color('#7B5CFF') },
        uB: { value: new Color('#2FB3C8') },
        uC: { value: new Color('#FF4FD8') },
        uFilm: { value: s.metalness > 0.5 ? 0.55 : 0.18 },
        uDim: { value: 1 },
        uRim: { value: new Color('#ffffff') },
        uRimAmt: { value: 0 },
      },
    ]),
  });
  const data: MatData = { base: shown.clone(), sheen: { value: 0 }, sheenBase: 0, pulse: m.uniforms.uRimAmt, pulseColor: m.uniforms.uRim, tip: { value: new Vector3() }, tipRadius: { value: 0 } };
  m.userData.tt = data;
  return m;
}

/** A material from the library for the given quality (high = tiers 2-3). */
export function makeMaterial(key: MatKey, high: boolean, cut: Cut = 'none'): Material {
  return high ? makeHigh(key, cut) : makeLow(key);
}

/** 0..1 brightness for one material, without allocating. */
export function setDim(m: Material, dim: number) {
  const d = m.userData.tt as MatData | undefined;
  if (!d) return;
  if ((m as ShaderMaterial).isShaderMaterial) {
    (m as ShaderMaterial).uniforms.uDim.value = dim;
    return;
  }
  (m as MeshStandardMaterial).color.copy(d.base).multiplyScalar(dim);
  d.sheen.value = d.sheenBase * dim;
}

/** Environment reflections relative to the material's default (high tier only; the cheap path has none). */
export function setEnv(m: Material, k: number) {
  const d = m.userData.tt as MatData | undefined;
  if (!d || (m as ShaderMaterial).isShaderMaterial) return;
  (m as MeshStandardMaterial).envMapIntensity = ENV_INTENSITY * k;
}

/** Where a material's pulse glows: builder-space centre and reach (high tier; the cheap path glows all over). */
export function setTip(m: Material, center: Vector3, radius: number) {
  const d = m.userData.tt as MatData | undefined;
  if (!d) return;
  d.tip.value.copy(center);
  d.tipRadius.value = radius;
}

/** Emissive pulse in a colour (rim on the cheap path), e.g. a sensor tip that "hears". */
export function setPulse(m: Material, amount: number, color: Color) {
  const d = m.userData.tt as MatData | undefined;
  if (!d) return;
  d.pulse.value = amount;
  d.pulseColor.value.copy(color);
}
