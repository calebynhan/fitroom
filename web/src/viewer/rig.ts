import * as THREE from 'three';

export interface BodyRig {
  body: THREE.SkinnedMesh;
  armature: THREE.Object3D;
  bonesByName: Map<string, THREE.Bone>;
}

export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  return found;
}

export function buildRig(root: THREE.Object3D): BodyRig | null {
  const body = findSkinnedMesh(root);
  if (!body) return null;
  const bonesByName = new Map(body.skeleton.bones.map((b) => [b.name, b] as const));
  return { body, armature: body.parent ?? root, bonesByName };
}

/** Morph weights named body_0..body_n, read from the mesh defaults (glTF mesh.weights). */
export function readBodyWeights(mesh: THREE.Mesh): number[] {
  const dict = mesh.morphTargetDictionary ?? {};
  const influences = mesh.morphTargetInfluences ?? [];
  const out: number[] = [];
  for (let i = 0; dict[`body_${i}`] !== undefined; i += 1) out.push(influences[dict[`body_${i}`]] ?? 0);
  return out;
}

export function applyBodyWeights(mesh: THREE.Mesh, weights: number[]): void {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) return;
  weights.forEach((w, i) => {
    const idx = dict[`body_${i}`];
    if (idx !== undefined) influences[idx] = w;
  });
}

/** Sets every fit_* morph: listed ones to their weight, the rest to 0 (CLAUDE.md fits contract). */
export function applyFitMorphs(mesh: THREE.Mesh, morphs: Record<string, number>): void {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) return;
  Object.entries(dict).forEach(([name, idx]) => {
    if (name.startsWith('fit_')) influences[idx] = morphs[name] ?? 0;
  });
}

/** Offset that puts the model's feet on y=0 and centres it on x/z. */
export function groundOffset(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return new THREE.Vector3();
  const center = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(-center.x, -box.min.y, -center.z);
}

/** Rebinds a garment SkinnedMesh to the avatar bones by name (CLAUDE.md contract). Returns null if a bone is missing. */
export function rebindToRig(garment: THREE.SkinnedMesh, rig: BodyRig): THREE.SkinnedMesh | null {
  const bones = garment.skeleton.bones.map((b) => rig.bonesByName.get(b.name));
  const missing = garment.skeleton.bones.filter((_, i) => !bones[i]).map((b) => b.name);
  if (missing.length > 0) {
    console.warn('[garment] bones missing on avatar:', missing.slice(0, 5));
    return null;
  }
  const clone = garment.clone();
  clone.bind(new THREE.Skeleton(bones as THREE.Bone[], garment.skeleton.boneInverses), garment.bindMatrix);
  clone.frustumCulled = false;
  return clone;
}
