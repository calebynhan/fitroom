import * as THREE from 'three';

interface FabricLook {
  roughness: number;
  sheen: number;
  sheenRoughness: number;
}

const LOOKS: Record<string, FabricLook> = {
  jersey: { roughness: 0.85, sheen: 0.35, sheenRoughness: 0.7 },
  rib_knit: { roughness: 0.95, sheen: 0.6, sheenRoughness: 0.6 },
  cashmere: { roughness: 0.95, sheen: 1.0, sheenRoughness: 0.5 },
  twill: { roughness: 0.8, sheen: 0.2, sheenRoughness: 0.8 },
  denim: { roughness: 0.9, sheen: 0.25, sheenRoughness: 0.8 },
};
const DEFAULT_LOOK = LOOKS.jersey;

/** Physical fabric material; keeps any normal map the pipeline baked into the source material. */
export function makeFabricMaterial(fabric: string, source?: THREE.Material | THREE.Material[]): THREE.MeshPhysicalMaterial {
  const look = LOOKS[fabric] ?? DEFAULT_LOOK;
  const base = Array.isArray(source) ? source[0] : source;
  const normalMap = (base as THREE.MeshStandardMaterial | undefined)?.normalMap ?? null;
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: look.roughness,
    metalness: 0,
    sheen: look.sheen,
    sheenRoughness: look.sheenRoughness,
    normalMap,
    side: THREE.DoubleSide,
  });
}

const WHITE = new THREE.Color('#ffffff');

export function tintFabric(material: THREE.MeshPhysicalMaterial, hex: string): void {
  material.color.set(hex);
  material.sheenColor.set(hex).lerp(WHITE, 0.35);
}
