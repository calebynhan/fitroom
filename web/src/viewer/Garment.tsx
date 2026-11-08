import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import type { Shape } from '../catalog/types';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { makeFabricMaterial, tintFabric } from './fabric';
import { applyBodyWeights, findSkinnedMesh, rebindToRig, type BodyRig } from './rig';
import { useAssetAvailable } from './useAssetAvailable';

export const garmentUrl = (shape: Shape): string => `/garments/${shape}.glb`;

interface GarmentProps {
  rig: BodyRig;
  shape: Shape;
  fabric: string;
  hex: string;
}

function GarmentModel({ rig, shape, fabric, hex }: GarmentProps) {
  const gltf = useGLTF(garmentUrl(shape));
  const source = useMemo(() => findSkinnedMesh(gltf.scene), [gltf.scene]);
  const mesh = useMemo(() => (source ? rebindToRig(source, rig) : null), [source, rig]);
  const material = useMemo(() => makeFabricMaterial(fabric, source?.material), [fabric, source]);
  const weights = useFit((s) => s.weights);

  useEffect(() => tintFabric(material, hex), [material, hex]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!mesh) return undefined;
    mesh.material = material;
    mesh.castShadow = true;
    rig.armature.add(mesh);
    return () => {
      rig.armature.remove(mesh);
    };
  }, [mesh, material, rig]);

  useEffect(() => {
    if (mesh && weights) applyBodyWeights(mesh, weights);
  }, [mesh, weights]);

  return null;
}

export function Garment(props: GarmentProps) {
  const status = useAssetAvailable(garmentUrl(props.shape));
  if (status !== 'ok') return null;
  return (
    <AssetBoundary name={garmentUrl(props.shape)}>
      <Suspense fallback={null}>
        <GarmentModel {...props} />
      </Suspense>
    </AssetBoundary>
  );
}
