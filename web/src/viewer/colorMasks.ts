// COLOR_0 on the GLBs carries masks, not tints (CLAUDE.md Garment GLB): .r = knit rib (crew collars, sweater cuffs and
// hem bands), .g = baked ambient occlusion (1 = open). Vertex colours stay off; the shader reads the channels itself.
import * as THREE from 'three';
import { fabricMaps } from './fabricTextures';

export const RIB_PATTERN = 'rib_band';
const AO_INTENSITY = 1;

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

export interface MaskOptions {
  /** Blend a rib normal map and groove shading by COLOR_0.r. */
  rib: boolean;
  /** Occlude indirect light by COLOR_0.g. */
  ao: boolean;
}

export const MASK_ANCHORS = {
  vertex: ['#include <common>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <map_fragment>', '#include <normal_fragment_maps>', '#include <aomap_fragment>'],
} as const;

const MAP_N_LINE = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
const AO_SAMPLE = 'texture2D( aoMap, vAoMapUv ).r';

function replaceOnce(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`mask shader: anchor not found: ${anchor}`);
  return source.replace(anchor, replacement);
}

function ribFragment(fragment: string): string {
  const normalChunk = replaceOnce(
    THREE.ShaderChunk.normal_fragment_maps,
    MAP_N_LINE,
    `${MAP_N_LINE}\n\tvec3 ribN = texture2D( ribNormalMap, vNormalMapUv * ribUvScale ).xyz * 2.0 - 1.0;\n\tmapN = normalize( mix( mapN, ribN, ribMask ) );`,
  );
  const withUniforms = replaceOnce(fragment, '#include <common>', '#include <common>\nuniform sampler2D ribNormalMap;\nuniform sampler2D ribAlbedoMap;\nuniform float ribUvScale;');
  const withAlbedo = replaceOnce(
    withUniforms,
    '#include <map_fragment>',
    '#include <map_fragment>\n\tfloat ribMask = clamp( vColorMasks.x, 0.0, 1.0 );\n\tfloat ribAlbedo = texture2D( ribAlbedoMap, vNormalMapUv * ribUvScale ).r;\n\tdiffuseColor.rgb *= mix( 1.0, ribAlbedo, ribMask );',
  );
  return replaceOnce(withAlbedo, '#include <normal_fragment_maps>', normalChunk);
}

/** three.js's own aoMap code (indirect diffuse, sheen, clearcoat and specular occlusion), fed by the vertex AO. */
function aoFragment(fragment: string): string {
  const chunk = replaceOnce(
    replaceOnce(THREE.ShaderChunk.aomap_fragment, '#ifdef USE_AOMAP', '#if 1'),
    `( ${AO_SAMPLE} - 1.0 ) * aoMapIntensity + 1.0`,
    '( clamp( vColorMasks.y, 0.0, 1.0 ) - 1.0 ) * vertexAoIntensity + 1.0',
  );
  const withUniform = replaceOnce(fragment, '#include <common>', '#include <common>\nuniform float vertexAoIntensity;');
  return replaceOnce(withUniform, '#include <aomap_fragment>', chunk);
}

/** Returns the shader with the requested COLOR_0 masks wired in. The rib needs a tangent-space normal map. */
export function patchMaskShader<T extends ShaderSource>(shader: T, { rib, ao }: MaskOptions): T {
  let vertexShader = replaceOnce(shader.vertexShader, '#include <common>', '#include <common>\nattribute vec4 color;\nvarying vec2 vColorMasks;');
  vertexShader = replaceOnce(vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n\tvColorMasks = color.rg;');
  let fragmentShader = replaceOnce(shader.fragmentShader, '#include <common>', '#include <common>\nvarying vec2 vColorMasks;');
  if (rib) fragmentShader = ribFragment(fragmentShader);
  if (ao) fragmentShader = aoFragment(fragmentShader);
  return { ...shader, vertexShader, fragmentShader };
}

function channelMax(attr: Attribute, read: (i: number) => number): number {
  let max = 0;
  for (let i = 0; i < attr.count; i += 1) max = Math.max(max, read(i));
  return max;
}

const SAME_CHANNEL = 1 / 255; // one 8-bit step

/**
 * True once the pipeline has baked AO into COLOR_0.g. Older GLBs write the rib mask as grey (g = r) or leave it all
 * zero; reading either as AO would black out the fabric.
 */
export function hasAoChannel(color: Attribute): boolean {
  return channelMax(color, (i) => Math.abs(color.getY(i) - color.getX(i))) > SAME_CHANNEL;
}

/** A body whose COLOR_0 is (0, ao, 0): AO only, not painted features. */
export function isAoOnly(color: Attribute): boolean {
  return hasAoChannel(color) && channelMax(color, (i) => Math.max(color.getX(i), color.getZ(i))) === 0;
}

export interface MaskSettings {
  /** Rib repeat / normal-map repeat, so the rib keeps its real size; omit for no rib. */
  ribUvScale?: number;
  ao: boolean;
}

/** Wires COLOR_0 masks into a standard or physical material. */
export function applyColorMasks(material: THREE.MeshStandardMaterial, { ribUvScale, ao }: MaskSettings): void {
  const rib = ribUvScale !== undefined && Boolean(material.normalMap);
  if (!rib && !ao) return;
  const maps = rib ? fabricMaps(RIB_PATTERN) : null;
  material.onBeforeCompile = (shader) => {
    if (maps) {
      shader.uniforms.ribNormalMap = { value: maps.normalMap };
      shader.uniforms.ribAlbedoMap = { value: maps.map };
      shader.uniforms.ribUvScale = { value: ribUvScale };
    }
    if (ao) shader.uniforms.vertexAoIntensity = { value: AO_INTENSITY };
    const patched = patchMaskShader(shader, { rib, ao });
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  material.customProgramCacheKey = () => `color-masks-${rib ? 'rib' : ''}-${ao ? 'ao' : ''}`;
}
