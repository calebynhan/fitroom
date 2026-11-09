import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import type { FitMorphs } from '../catalog/fits';
import { garmentUrl } from '../body/models';
import type { Shape, Slot } from '../catalog/types';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { disposeFabric, makeFabricMaterial, tintFabric } from './fabric';
import { orientGarmentFaces } from './orientFaces';
import { applyBodyWeights, applyFitMorphs, findSkinnedMesh, rebindToRig, type BodyRig } from './rig';
import { useAssetAvailable } from './useAssetAvailable';

interface GarmentProps {
  rig: BodyRig;
  slot: Slot;
  onReady?: (slot: Slot, ready: boolean) => void;
  shape: Shape;
  fabric: string;
  hex: string;
  fitMorphs: FitMorphs;
}

function GarmentModel({ rig, slot, onReady, shape, fabric, hex, fitMorphs }: GarmentProps) {
  const model = useFit((s) => s.model);
  const gltf = useGLTF(garmentUrl(model, shape));
  const source = useMemo(() => {
    const found = findSkinnedMesh(gltf.scene);
    if (found) orientGarmentFaces(found.geometry);
    return found;
  }, [gltf.scene]);
  const mesh = useMemo(() => (source ? rebindToRig(source, rig) : null), [source, rig]);
  const material = useMemo(() => makeFabricMaterial(fabric, source?.material, source?.geometry), [fabric, source]);
  const weights = useFit((s) => s.weights);

  useEffect(() => tintFabric(material, hex), [material, hex]);
  useEffect(() => () => disposeFabric(material), [material]);

  useEffect(() => {
    if (!mesh) return undefined;
    mesh.material = material;
    mesh.castShadow = true;
    rig.armature.add(mesh);
    onReady?.(slot, true);
    return () => {
      onReady?.(slot, false);
      rig.armature.remove(mesh);
      mesh.skeleton.dispose(); // bone texture; geometry is shared with the useGLTF cache
    };
  }, [mesh, material, rig, slot, onReady]);

  useEffect(() => {
    if (mesh && weights) applyBodyWeights(mesh, weights);
  }, [mesh, weights]);

  useEffect(() => {
    if (mesh) applyFitMorphs(mesh, fitMorphs);
  }, [mesh, fitMorphs]);

  return null;
}

export function Garment(props: GarmentProps) {
  const model = useFit((s) => s.model);
  const url = garmentUrl(model, props.shape);
  const status = useAssetAvailable(url);
  if (status !== 'ok') return null;
  return (
    <AssetBoundary key={url} name={url}>
      <Suspense fallback={null}>
        <GarmentModel {...props} />
      </Suspense>
    </AssetBoundary>
  );
}
