// Simple mannequin shoes, always worn: the pose clips lift the feet 1.8 cm onto their soles (CLAUDE.md Body GLB).
import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { garmentUrl } from '../body/models';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { applyBodyWeights, findSkinnedMesh, rebindToRig, type BodyRig } from './rig';
import { useAssetAvailable } from './useAssetAvailable';

export const SHOES_SHAPE = 'shoes';
const SHOE_COLOR = '#3A3835'; // design-system graphite: reads as a plain matte leather low-top
const SHOE_ROUGHNESS = 0.72;

export type ShoesReady = (piece: 'shoes', ready: boolean) => void;

interface ShoesProps {
  rig: BodyRig;
  onReady: ShoesReady;
}

/** Nothing to wait for (no shoes for this body, or they failed to load): let the outfit reveal anyway. */
function Settled({ onReady }: { onReady: ShoesReady }) {
  useEffect(() => onReady('shoes', true), [onReady]);
  return null;
}

function makeShoeMaterial(): THREE.MeshStandardMaterial {
  // The GLB's COLOR_0 is a rib mask (all 0 on shoes), so vertex colours stay off.
  return new THREE.MeshStandardMaterial({ color: SHOE_COLOR, roughness: SHOE_ROUGHNESS, metalness: 0, side: THREE.DoubleSide });
}

function ShoesModel({ rig, onReady }: ShoesProps) {
  const model = useFit((s) => s.model);
  const gltf = useGLTF(garmentUrl(model, SHOES_SHAPE));
  const source = useMemo(() => findSkinnedMesh(gltf.scene), [gltf.scene]);
  const mesh = useMemo(() => (source ? rebindToRig(source, rig) : null), [source, rig]);
  const material = useMemo(makeShoeMaterial, []);
  const weights = useFit((s) => s.weights);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!mesh) {
      onReady('shoes', true);
      return undefined;
    }
    mesh.material = material;
    mesh.castShadow = true;
    rig.armature.add(mesh);
    onReady('shoes', true);
    return () => {
      onReady('shoes', false);
      rig.armature.remove(mesh);
      mesh.skeleton.dispose(); // bone texture; geometry is shared with the useGLTF cache
    };
  }, [mesh, material, rig, onReady]);

  useEffect(() => {
    if (mesh && weights) applyBodyWeights(mesh, weights);
  }, [mesh, weights]);

  return null;
}

export function Shoes({ rig, onReady }: ShoesProps) {
  const model = useFit((s) => s.model);
  const url = garmentUrl(model, SHOES_SHAPE);
  const status = useAssetAvailable(url);
  if (status === 'checking') return null;
  if (status === 'missing') return <Settled onReady={onReady} />;
  return (
    <AssetBoundary key={url} name={url} fallback={<Settled onReady={onReady} />}>
      <Suspense fallback={null}>
        <ShoesModel rig={rig} onReady={onReady} />
      </Suspense>
    </AssetBoundary>
  );
}
