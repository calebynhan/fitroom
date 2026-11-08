// Thin dark rectangular frames (the user wears them), attached to the head bone so they follow every pose.
// Coordinates are body.glb rest-pose metres (Y up, +Z forward) from Session A.
import { useEffect } from 'react';
import * as THREE from 'three';
import type { BodyRig } from './rig';

const HEAD_BONE = 'c_head';
const LENS_X = 0.0328;
const LENS_Y = 1.663;
const LENS_Z = 0.136;
const LENS_W = 0.048;
const LENS_H = 0.03;
const RIM = 0.0032;
const BRIDGE_Y = 1.667;
const TEMPLE_X = 0.071;
const TEMPLE_Y = 1.665;
const TEMPLE_BACK_Z = 0.02;
const FRAME_COLOR = '#1b1b1d';

function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Builds the frames in rest-pose body space. */
function buildFrames(): THREE.Group {
  const frame = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.3, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.08, depthWrite: false });
  const group = new THREE.Group();
  [-1, 1].forEach((side) => {
    const cx = side * LENS_X;
    group.add(box(LENS_W, RIM, RIM, cx, LENS_Y + LENS_H / 2, LENS_Z, frame)); // top
    group.add(box(LENS_W, RIM, RIM, cx, LENS_Y - LENS_H / 2, LENS_Z, frame)); // bottom
    group.add(box(RIM, LENS_H, RIM, cx - LENS_W / 2, LENS_Y, LENS_Z, frame)); // inner/outer sides
    group.add(box(RIM, LENS_H, RIM, cx + LENS_W / 2, LENS_Y, LENS_Z, frame));
    const outer = side * (LENS_X + LENS_W / 2);
    group.add(box(Math.abs(side * TEMPLE_X - outer), RIM, RIM, (outer + side * TEMPLE_X) / 2, TEMPLE_Y, LENS_Z, frame)); // hinge
    const armLen = LENS_Z - TEMPLE_BACK_Z;
    group.add(box(RIM * 0.9, RIM * 1.2, armLen, side * TEMPLE_X, TEMPLE_Y, TEMPLE_BACK_Z + armLen / 2, frame)); // temple arm
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(LENS_W - RIM, LENS_H - RIM), glass);
    lens.position.set(cx, LENS_Y, LENS_Z);
    group.add(lens);
  });
  const bridgeW = 2 * LENS_X - LENS_W;
  group.add(box(bridgeW, RIM * 0.8, RIM, 0, BRIDGE_Y, LENS_Z, frame));
  return group;
}

function disposeGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    materials.add(mesh.material as THREE.Material);
  });
  materials.forEach((m) => m.dispose());
}

export function Glasses({ rig }: { rig: BodyRig }) {
  useEffect(() => {
    const bone = rig.bonesByName.get(HEAD_BONE);
    const index = bone ? rig.body.skeleton.bones.indexOf(bone) : -1;
    if (!bone || index < 0) {
      console.warn('[glasses] head bone not found:', HEAD_BONE);
      return undefined;
    }
    // Rest-pose body space -> head-bone local space: boneInverse * bindMatrix (independent of the current pose).
    const toBone = new THREE.Matrix4().multiplyMatrices(rig.body.skeleton.boneInverses[index], rig.body.bindMatrix);
    const frames = buildFrames();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(toBone);
    holder.add(frames);
    bone.add(holder);
    return () => {
      bone.remove(holder);
      disposeGroup(frames);
    };
  }, [rig]);
  return null;
}
