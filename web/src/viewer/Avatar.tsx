import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MODELS } from '../body/models';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { Garment } from './Garment';
import { PlaceholderBody } from './PlaceholderBody';
import { POSE_FADE_S } from './poses';
import { applyBodyWeights, buildRig, groundOffset, readBodyWeights, type BodyRig } from './rig';
import { useAssetAvailable } from './useAssetAvailable';
import { useOutfitLooks } from './useOutfitLooks';

// Matte store-mannequin ivory, so the head and hands read as intentional.
export const MANNEQUIN_COLOR = '#EDEAE4';
const MANNEQUIN_ROUGHNESS = 0.55;

function styleBody(mesh: THREE.SkinnedMesh): void {
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.material = new THREE.MeshStandardMaterial({ color: MANNEQUIN_COLOR, roughness: MANNEQUIN_ROUGHNESS, metalness: 0 });
}

function Outfit({ rig }: { rig: BodyRig }) {
  const looks = useOutfitLooks();
  return (
    <>
      {looks.top && <Garment key={`top-${looks.top.shape}`} rig={rig} {...looks.top} />}
      {looks.bottom && <Garment key={`bottom-${looks.bottom.shape}`} rig={rig} {...looks.bottom} />}
    </>
  );
}

/** Plays the selected pose clip (single keyframe each) and crossfades on change. */
function usePose(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const pose = useFit((s) => s.pose);
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const current = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(clips, pose);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    const prev = current.current;
    if (prev === next) return;
    next.reset().play();
    if (prev) prev.crossFadeTo(next, POSE_FADE_S, false);
    else mixer.update(0);
    current.current = next;
  }, [mixer, clips, pose]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      current.current = null;
    },
    [mixer],
  );

  useFrame((_, delta) => mixer.update(delta));
}

function BodyModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const rig = useMemo(() => buildRig(gltf.scene), [gltf.scene]);
  const offset = useMemo(() => groundOffset(gltf.scene), [gltf.scene]);
  const weights = useFit((s) => s.weights);
  const initWeights = useFit((s) => s.initWeights);
  usePose(gltf.scene, gltf.animations);

  useEffect(() => {
    if (!rig) return;
    styleBody(rig.body);
    initWeights(readBodyWeights(rig.body));
  }, [rig, initWeights]);

  useEffect(() => {
    if (rig && weights) applyBodyWeights(rig.body, weights);
  }, [rig, weights]);

  return (
    <group position={offset}>
      <primitive object={gltf.scene} />
      {rig && <Outfit rig={rig} />}
    </group>
  );
}

export function Avatar() {
  const model = useFit((s) => s.model);
  const config = MODELS[model];
  const status = useAssetAvailable(config.bodyUrl);
  const heightCm = useFit((s) => s.heightCm);
  const scale = heightCm / config.baseHeightCm;
  return (
    <group scale={scale}>
      {status === 'ok' && (
        <AssetBoundary key={model} name={config.bodyUrl} fallback={<PlaceholderBody />}>
          <Suspense fallback={<PlaceholderBody />}>
            <BodyModel url={config.bodyUrl} />
          </Suspense>
        </AssetBoundary>
      )}
      {status === 'missing' && <PlaceholderBody />}
    </group>
  );
}
