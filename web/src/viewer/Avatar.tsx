import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { BASE_HEIGHT_CM } from '../body/measurements';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { Garment } from './Garment';
import { PlaceholderBody } from './PlaceholderBody';
import { applyBodyWeights, buildRig, groundOffset, readBodyWeights, type BodyRig } from './rig';
import { useAssetAvailable } from './useAssetAvailable';
import { useOutfitLooks } from './useOutfitLooks';

export const BODY_URL = '/models/body.glb';

function styleBody(mesh: THREE.SkinnedMesh): void {
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const current = mesh.material as THREE.MeshStandardMaterial;
  if (!current.map) {
    mesh.material = new THREE.MeshPhysicalMaterial({
      color: '#c99a7e',
      roughness: 0.55,
      sheen: 0.25,
      sheenColor: new THREE.Color('#ffd9c4'),
    });
  }
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

function BodyModel() {
  const gltf = useGLTF(BODY_URL);
  const rig = useMemo(() => buildRig(gltf.scene), [gltf.scene]);
  const offset = useMemo(() => groundOffset(gltf.scene), [gltf.scene]);
  const weights = useFit((s) => s.weights);
  const initWeights = useFit((s) => s.initWeights);

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
  const status = useAssetAvailable(BODY_URL);
  const heightCm = useFit((s) => s.heightCm);
  const scale = heightCm / BASE_HEIGHT_CM;
  return (
    <group scale={scale}>
      {status === 'ok' && (
        <AssetBoundary name={BODY_URL} fallback={<PlaceholderBody />}>
          <Suspense fallback={<PlaceholderBody />}>
            <BodyModel />
          </Suspense>
        </AssetBoundary>
      )}
      {status === 'missing' && <PlaceholderBody />}
    </group>
  );
}
