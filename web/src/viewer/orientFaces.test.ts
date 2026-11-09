import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { orientFacesToNormals } from './orientFaces';

// Two triangles in the z = 0 plane. Counter-clockwise (0,1,2) faces +z; (3,5,4) is wound clockwise.
const POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0];
const UP = [0, 0, 1];

function attr(values: number[]): THREE.BufferAttribute {
  return new THREE.BufferAttribute(new Float32Array(values), 3);
}

describe('orientFacesToNormals', () => {
  it('rewinds only the faces that disagree with their vertex normals', () => {
    const normals = attr(Array.from({ length: 6 }, () => UP).flat());
    const index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 3, 5, 4]), 1);
    expect(Array.from(orientFacesToNormals(attr(POSITIONS), normals, index) ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns null when every face already agrees', () => {
    const normals = attr(Array.from({ length: 6 }, () => UP).flat());
    const index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 3, 4, 5]), 1);
    expect(orientFacesToNormals(attr(POSITIONS), normals, index)).toBeNull();
  });

  it('builds an index for non-indexed geometry', () => {
    const normals = attr([...UP, ...UP, ...UP, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
    // second face is counter-clockwise (+z) but its normals point -z
    expect(Array.from(orientFacesToNormals(attr(POSITIONS), normals, null) ?? [])).toEqual([0, 1, 2, 3, 5, 4]);
  });

  it('reads normalized integer normals by sign, not raw magnitude', () => {
    const normals = new THREE.BufferAttribute(new Int8Array(Array.from({ length: 6 }, () => [0, 0, -127]).flat()), 3, true);
    const index = new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 3, 4, 5]), 1);
    expect(Array.from(orientFacesToNormals(attr(POSITIONS), normals, index) ?? [])).toEqual([0, 2, 1, 3, 5, 4]);
  });

  it('leaves zero-area faces alone', () => {
    const flat = attr([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const normals = attr([0, 0, -1, 0, 0, -1, 0, 0, -1]);
    expect(orientFacesToNormals(flat, normals, null)).toBeNull();
  });
});
