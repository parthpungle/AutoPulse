import { Color, MeshPhysicalMaterial, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import type { Material } from 'three';
import { GLSL } from '../shaders';
import type { Palette } from '../theme';

/**
 * The shared material set for the crankshaft and sensor models:
 *  - iridescent metal: MeshPhysicalMaterial with thin-film iridescence, lit by the procedural
 *    environment (tiers 2-3), or SheenMaterial, a fresnel + three-colour gradient fake (tiers 0-1)
 *  - dark satin plastic #121418 and brass #B08D57 for threaded parts
 * Both tier variants exist from the start and are compiled during the preloader, so a quality drop
 * only swaps materials and never compiles mid-scroll.
 */
export interface MaterialSet {
  metal: Material;
  plastic: Material;
  brass: Material;
}

export function makeIridescent(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color('#8F8BB0'),
    metalness: 1,
    roughness: 0.25,
    iridescence: 0.6,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 620],
    envMapIntensity: 0.85,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
  });
}

export function makePlastic(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color: new Color('#121418'), metalness: 0.05, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 });
}

export function makeBrass(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color: new Color('#B08D57'), metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
}

export function makeSheen(palette: Palette, base = '#2A2C3A'): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GLSL.sheenVert,
    fragmentShader: GLSL.sheenFrag,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBase: { value: new Color(base) },
        uA: { value: new Color('#7B5CFF') },
        uB: { value: palette.hazeTeal.clone().multiplyScalar(4) },
        uC: { value: new Color('#FF4FD8') },
        uDim: { value: 1 },
        uRim: { value: new Color('#ffffff') },
        uRimAmt: { value: 0 },
      },
    ]),
  });
}

export function makeHighSet(): MaterialSet {
  return { metal: makeIridescent(), plastic: makePlastic(), brass: makeBrass() };
}

export function makeLowSet(palette: Palette): MaterialSet {
  return { metal: makeSheen(palette), plastic: makeSheen(palette, '#0C0D11'), brass: makeSheen(palette, '#5A4626') };
}

/** Sets a 0..1 brightness on either variant (physical: colour scale; sheen: uDim). */
export function setDim(m: Material, base: Color, dim: number) {
  if ((m as ShaderMaterial).isShaderMaterial) (m as ShaderMaterial).uniforms.uDim.value = dim;
  else (m as MeshPhysicalMaterial).color.copy(base).multiplyScalar(dim);
}

export function disposeSet(set: MaterialSet) {
  set.metal.dispose();
  set.plastic.dispose();
  set.brass.dispose();
}
