import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hasAoChannel, isAoOnly, MASK_ANCHORS, patchMaskShader } from './colorMasks';

function physicalShader(): { vertexShader: string; fragmentShader: string } {
  const lib = THREE.ShaderLib.physical;
  return { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
}

function colors(rgba: number[][]): THREE.BufferAttribute {
  return new THREE.BufferAttribute(new Uint8Array(rgba.flat()), 4, true);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('patchMaskShader', () => {
  it("finds every anchor in this three.js version's physical shader (standard shares it)", () => {
    const { vertexShader, fragmentShader } = physicalShader();
    MASK_ANCHORS.vertex.forEach((a) => expect(vertexShader).toContain(a));
    MASK_ANCHORS.fragment.forEach((a) => expect(fragmentShader).toContain(a));
    expect(THREE.ShaderLib.standard.fragmentShader).toBe(fragmentShader);
  });

  it('reads COLOR_0 once, as a mask, without turning on vertex colours', () => {
    const { vertexShader } = patchMaskShader(physicalShader(), { rib: true, ao: true });
    expect(count(vertexShader, 'attribute vec4 color;')).toBe(1);
    expect(vertexShader).toContain('vColorMasks = color.rg;');
    expect(vertexShader).not.toContain('#define USE_COLOR');
  });

  it('rib: blends the rib normal and albedo by the red channel', () => {
    const { fragmentShader } = patchMaskShader(physicalShader(), { rib: true, ao: false });
    expect(fragmentShader).toContain('uniform sampler2D ribNormalMap;');
    expect(fragmentShader).toContain('ribUvScale');
    expect(fragmentShader).toMatch(/mix\(\s*mapN,\s*ribN/);
    expect(fragmentShader).toMatch(/diffuseColor\.rgb \*= mix\( 1\.0, ribAlbedo/);
    expect(fragmentShader).not.toContain('#include <normal_fragment_maps>');
    expect(fragmentShader).not.toContain('vertexAoIntensity');
  });

  it('ao: occludes indirect light by the green channel, the way three.js applies an aoMap', () => {
    const { fragmentShader } = patchMaskShader(physicalShader(), { rib: false, ao: true });
    expect(fragmentShader).toContain('uniform float vertexAoIntensity;');
    expect(fragmentShader).toContain('reflectedLight.indirectDiffuse *= ambientOcclusion;');
    expect(fragmentShader).toContain('vColorMasks.y');
    expect(fragmentShader).not.toContain('#include <aomap_fragment>');
    expect(fragmentShader).not.toContain('texture2D( aoMap');
    expect(fragmentShader).not.toContain('ribNormalMap');
  });

  it('throws if an anchor is missing (three.js changed its shader)', () => {
    expect(() => patchMaskShader({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}' }, { rib: true, ao: true })).toThrow(
      /anchor/,
    );
  });
});

describe('hasAoChannel', () => {
  it('is false for masks written as grey (green copies the rib mask) and for all-zero shoes', () => {
    expect(hasAoChannel(colors([[255, 255, 255, 255], [0, 0, 0, 255], [178, 178, 178, 255]]))).toBe(false);
    expect(hasAoChannel(colors([[0, 0, 0, 255], [0, 0, 0, 255]]))).toBe(false);
  });

  it('is true once AO is baked into green, rib or not', () => {
    expect(hasAoChannel(colors([[255, 240, 0, 255], [0, 60, 0, 255]]))).toBe(true);
    expect(hasAoChannel(colors([[0, 250, 0, 255]]))).toBe(true);
  });
});

describe('isAoOnly', () => {
  it('tells a baked-AO body (0, ao, 0) from painted vertex colours', () => {
    expect(isAoOnly(colors([[0, 240, 0, 255], [0, 59, 0, 255]]))).toBe(true);
    expect(isAoOnly(colors([[200, 180, 160, 255]]))).toBe(false);
    expect(isAoOnly(colors([[0, 0, 0, 255]]))).toBe(false);
  });
});
