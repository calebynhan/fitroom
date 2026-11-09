import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchRibShader, RIB_ANCHORS } from './ribBands';

function physicalShader(): { vertexShader: string; fragmentShader: string } {
  const lib = THREE.ShaderLib.physical;
  return { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
}

describe('patchRibShader', () => {
  it("finds every anchor in this three.js version's physical shader", () => {
    const { vertexShader, fragmentShader } = physicalShader();
    RIB_ANCHORS.vertex.forEach((a) => expect(vertexShader).toContain(a));
    RIB_ANCHORS.fragment.forEach((a) => expect(fragmentShader).toContain(a));
  });

  it('reads the rib mask from COLOR_0.r without turning on vertex colours', () => {
    const { vertexShader } = patchRibShader(physicalShader());
    expect(vertexShader).toContain('attribute vec4 color;');
    expect(vertexShader).toContain('vRibMask = color.r;');
    expect(vertexShader).not.toContain('#define USE_COLOR');
  });

  it('blends the rib normal and albedo by the mask', () => {
    const { fragmentShader } = patchRibShader(physicalShader());
    expect(fragmentShader).toContain('uniform sampler2D ribNormalMap;');
    expect(fragmentShader).toContain('uniform sampler2D ribAlbedoMap;');
    expect(fragmentShader).toContain('ribUvScale');
    expect(fragmentShader).toMatch(/mix\(\s*mapN,\s*ribN/);
    expect(fragmentShader).toMatch(/diffuseColor\.rgb \*= mix\( 1\.0, ribAlbedo/);
    // the stock chunk is inlined, so no include of it is left behind
    expect(fragmentShader).not.toContain('#include <normal_fragment_maps>');
  });

  it('throws if an anchor is missing (three.js changed its shader)', () => {
    expect(() => patchRibShader({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}' })).toThrow(/anchor/);
  });
});
