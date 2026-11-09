// Knit rib on crew collars, sweater cuffs and hem bands. The garment GLB's COLOR_0.r is the rib mask (CLAUDE.md
// Garment GLB): 1 on the bands, 0 elsewhere. It is a mask, not a tint, so vertex colours stay off and the shader
// reads it directly, then blends a fine rib normal map (and its groove shading) over the fabric's own.
import * as THREE from 'three';
import { fabricMaps } from './fabricTextures';

export const RIB_PATTERN = 'rib_band';

interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

export const RIB_ANCHORS = {
  vertex: ['#include <common>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <map_fragment>', '#include <normal_fragment_maps>'],
} as const;

const MAP_N_LINE = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';

function replaceOnce(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`rib shader: anchor not found: ${anchor}`);
  return source.replace(anchor, replacement);
}

/** Returns the shader with the rib mask wired in. Needs a tangent-space normal map on the material. */
export function patchRibShader<T extends ShaderSource>(shader: T): T {
  let vertexShader = replaceOnce(shader.vertexShader, '#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vRibMask;');
  vertexShader = replaceOnce(vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n\tvRibMask = color.r;');

  const normalChunk = replaceOnce(
    THREE.ShaderChunk.normal_fragment_maps,
    MAP_N_LINE,
    `${MAP_N_LINE}\n\tvec3 ribN = texture2D( ribNormalMap, vNormalMapUv * ribUvScale ).xyz * 2.0 - 1.0;\n\tmapN = normalize( mix( mapN, ribN, ribMask ) );`,
  );
  let fragmentShader = replaceOnce(
    shader.fragmentShader,
    '#include <common>',
    '#include <common>\nuniform sampler2D ribNormalMap;\nuniform sampler2D ribAlbedoMap;\nuniform float ribUvScale;\nvarying float vRibMask;',
  );
  fragmentShader = replaceOnce(
    fragmentShader,
    '#include <map_fragment>',
    '#include <map_fragment>\n\tfloat ribMask = clamp( vRibMask, 0.0, 1.0 );\n\tfloat ribAlbedo = texture2D( ribAlbedoMap, vNormalMapUv * ribUvScale ).r;\n\tdiffuseColor.rgb *= mix( 1.0, ribAlbedo, ribMask );',
  );
  fragmentShader = replaceOnce(fragmentShader, '#include <normal_fragment_maps>', normalChunk);
  return { ...shader, vertexShader, fragmentShader };
}

/**
 * Adds rib bands to a fabric material. `ribUvScale` converts the material's normal-map UVs into rib tiles
 * (rib repeat / normal-map repeat), so the rib keeps its real size whatever the fabric's tile is.
 */
export function applyRibBands(material: THREE.MeshPhysicalMaterial, ribUvScale: number): void {
  if (!material.normalMap) return;
  const maps = fabricMaps(RIB_PATTERN);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ribNormalMap = { value: maps.normalMap };
    shader.uniforms.ribAlbedoMap = { value: maps.map };
    shader.uniforms.ribUvScale = { value: ribUvScale };
    const patched = patchRibShader(shader);
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  material.customProgramCacheKey = () => 'fabric-rib';
}
