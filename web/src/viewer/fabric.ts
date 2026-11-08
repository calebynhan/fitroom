import * as THREE from 'three';
import { fabricMaps, metresPerUv, PATTERNS } from './fabricTextures';

interface FabricLook {
  roughness: number;
  sheen: number; // kept low: a bright sheen rim reads as a puffer jacket
  sheenRoughness: number;
  normalScale: number;
}

const LOOKS: Record<string, FabricLook> = {
  jersey: { roughness: 0.92, sheen: 0.15, sheenRoughness: 0.9, normalScale: 0.6 },
  rib_knit: { roughness: 0.95, sheen: 0.25, sheenRoughness: 0.85, normalScale: 1.0 },
  cashmere: { roughness: 0.95, sheen: 0.4, sheenRoughness: 0.7, normalScale: 0.6 },
  twill: { roughness: 0.85, sheen: 0.1, sheenRoughness: 0.9, normalScale: 0.6 },
  denim: { roughness: 0.88, sheen: 0.08, sheenRoughness: 0.9, normalScale: 0.9 },
};
const DEFAULT_LOOK = LOOKS.jersey;
const FALLBACK_REPEAT = 20;
const SHEEN_LIGHTEN = 0.08;

function repeatFor(fabric: string, geometry?: THREE.BufferGeometry): number {
  const perUv = geometry ? metresPerUv(geometry) : null;
  const tile = (PATTERNS[fabric] ?? PATTERNS.jersey).tileMetres;
  return perUv ? perUv / tile : FALLBACK_REPEAT;
}

function tiled(base: THREE.Texture, repeat: number): THREE.Texture {
  const tex = base.clone();
  tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

/** Physical fabric with procedural weave/knit relief and albedo detail, tiled to real-world size. */
export function makeFabricMaterial(
  fabric: string,
  source?: THREE.Material | THREE.Material[],
  geometry?: THREE.BufferGeometry,
): THREE.MeshPhysicalMaterial {
  const look = LOOKS[fabric] ?? DEFAULT_LOOK;
  const base = Array.isArray(source) ? source[0] : source;
  const bakedNormal = (base as THREE.MeshStandardMaterial | undefined)?.normalMap ?? null;
  const maps = fabricMaps(fabric);
  const repeat = repeatFor(fabric, geometry);
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: tiled(maps.map, repeat),
    normalMap: bakedNormal ?? tiled(maps.normalMap, repeat),
    normalScale: new THREE.Vector2(look.normalScale, look.normalScale),
    roughness: look.roughness,
    metalness: 0,
    sheen: look.sheen,
    sheenRoughness: look.sheenRoughness,
    side: THREE.DoubleSide,
  });
}

const WHITE = new THREE.Color('#ffffff');

export function tintFabric(material: THREE.MeshPhysicalMaterial, hex: string): void {
  material.color.set(hex);
  material.sheenColor.set(hex).lerp(WHITE, SHEEN_LIGHTEN);
}

/** Disposes the per-material texture clones (the shared canvases stay cached). */
export function disposeFabric(material: THREE.MeshPhysicalMaterial): void {
  material.map?.dispose();
  material.normalMap?.dispose();
  material.dispose();
}
