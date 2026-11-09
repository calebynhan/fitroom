// Single-sided cloth is drawn DoubleSide, and three.js flips the shading normal of every face whose winding makes it a
// back face. A face wound against its own vertex normals is therefore lit from behind: a bright speck on dark fabric.
import * as THREE from 'three';

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

const MIN_AREA2 = 1e-14; // squared |cross| below this is a zero-area sliver: leave it as it is

/**
 * Returns a new triangle index where every face is wound counter-clockwise around its vertex normals,
 * or null when every face already agrees.
 */
export function orientFacesToNormals(position: Attribute, normal: Attribute, index: Attribute | null): Uint32Array | null {
  const count = index ? index.count : position.count;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = index ? index.getX(i) : i;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  const summed = new THREE.Vector3();
  const n = new THREE.Vector3();
  let flipped = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const [i0, i1, i2] = [out[t], out[t + 1], out[t + 2]];
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1).sub(a);
    c.fromBufferAttribute(position, i2).sub(a);
    face.crossVectors(b, c);
    if (face.lengthSq() < MIN_AREA2) continue;
    summed.fromBufferAttribute(normal, i0).add(n.fromBufferAttribute(normal, i1)).add(n.fromBufferAttribute(normal, i2));
    if (face.dot(summed) < 0) {
      out[t + 1] = i2;
      out[t + 2] = i1;
      flipped += 1;
    }
  }
  return flipped > 0 ? out : null;
}

const ORIENTED = 'facesOriented';

/** Rewinds a loaded garment's faces once (the geometry is shared by every mount through the GLTF cache). */
export function orientGarmentFaces(geometry: THREE.BufferGeometry): void {
  if (geometry.userData[ORIENTED]) return;
  const { position, normal } = geometry.attributes;
  const fixed = position && normal ? orientFacesToNormals(position, normal, geometry.index) : null;
  if (fixed) geometry.setIndex(new THREE.BufferAttribute(fixed, 1));
  geometry.userData = { ...geometry.userData, [ORIENTED]: true };
}
