import * as THREE from 'three';

// One soft-cloth look for every garment; colour comes from the catalog swatch.
const FABRIC_ROUGHNESS = 0.85;
const FABRIC_SHEEN = 0.6;
const FABRIC_SHEEN_ROUGHNESS = 0.8;
const SHEEN_LIGHTEN = 0.2; // sheen colour = base colour nudged toward white

/** Physical fabric material; keeps any normal map the pipeline baked into the source material. */
export function makeFabricMaterial(_fabric: string, source?: THREE.Material | THREE.Material[]): THREE.MeshPhysicalMaterial {
  const base = Array.isArray(source) ? source[0] : source;
  const normalMap = (base as THREE.MeshStandardMaterial | undefined)?.normalMap ?? null;
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: FABRIC_ROUGHNESS,
    metalness: 0,
    sheen: FABRIC_SHEEN,
    sheenRoughness: FABRIC_SHEEN_ROUGHNESS,
    normalMap,
    side: THREE.DoubleSide,
  });
}

const WHITE = new THREE.Color('#ffffff');

export function tintFabric(material: THREE.MeshPhysicalMaterial, hex: string): void {
  material.color.set(hex);
  material.sheenColor.set(hex).lerp(WHITE, SHEEN_LIGHTEN);
}
