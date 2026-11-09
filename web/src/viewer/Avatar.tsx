import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { garmentUrl, MODELS, type ModelId } from '../body/models';
import type { Slot } from '../catalog/types';
import { useFit } from '../state/store';
import { AssetBoundary } from './AssetBoundary';
import { applyColorMasks, isAoOnly } from './colorMasks';
import { Garment } from './Garment';
import { Glasses } from './Glasses';
import { PlaceholderBody } from './PlaceholderBody';
import { POSE_FADE_S } from './poses';
import { applyBodyWeights, buildRig, groundOffset, readBodyWeights, type BodyRig } from './rig';
import { Shoes, SHOES_SHAPE } from './Shoes';
import { primeAsset, useAssetAvailable } from './useAssetAvailable';
import { useOutfitLooks } from './useOutfitLooks';

// Matte store-mannequin ivory, so the head and hands read as intentional.
export const MANNEQUIN_COLOR = '#EDEAE4';
const MANNEQUIN_ROUGHNESS = 0.85; // matte, no plastic sheen on the head and hands

function styleBody(mesh: THREE.SkinnedMesh): void {
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  // Painted features (baseColorTexture, or a painted COLOR_0) show on a white base; else mannequin ivory.
  // The mannequin's COLOR_0 = (0, ao, 0) is baked AO, not paint (CLAUDE.md Body GLB).
  const map = (mesh.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const color = mesh.geometry.getAttribute('color');
  const aoOnly = Boolean(color) && isAoOnly(color);
  const painted = !map && Boolean(color) && !aoOnly;
  const material = new THREE.MeshStandardMaterial({
    map,
    color: map || painted ? '#ffffff' : MANNEQUIN_COLOR,
    vertexColors: painted,
    roughness: MANNEQUIN_ROUGHNESS,
    metalness: 0,
  });
  if (aoOnly) applyColorMasks(material, { ao: true });
  mesh.material = material;
}

const REVEAL_TIMEOUT_MS = 10_000; // show the body anyway if a garment never arrives
const GARMENT_SHAPES = ['tee', 'sweater', 'pants', SHOES_SHAPE] as const;

/** Fetch every garment (and the shoes) for this body up front so swaps never flash skin. */
function usePreloadGarments(model: ModelId): void {
  useEffect(() => {
    GARMENT_SHAPES.forEach((shape) => {
      const url = garmentUrl(model, shape);
      void primeAsset(url).then((ok) => ok && useGLTF.preload(url));
    });
  }, [model]);
}

/** Everything the body waits for before its first reveal. */
type Piece = Slot | 'shoes';

interface OutfitProps {
  rig: BodyRig;
  onDressed: () => void;
}

function Outfit({ rig, onDressed }: OutfitProps) {
  const looks = useOutfitLooks();
  const [ready, setReady] = useState<Record<Piece, boolean>>({ top: false, bottom: false, shoes: false });
  const markReady = useCallback(
    (piece: Piece, ok: boolean) => setReady((r) => (r[piece] === ok ? r : { ...r, [piece]: ok })),
    [],
  );
  const dressed = Boolean(looks.top && looks.bottom && ready.top && ready.bottom && ready.shoes);
  useEffect(() => {
    if (dressed) onDressed();
  }, [dressed, onDressed]);
  return (
    <>
      {looks.top && <Garment key={`top-${looks.top.shape}`} rig={rig} onReady={markReady} {...looks.top} />}
      {looks.bottom && <Garment key={`bottom-${looks.bottom.shape}`} rig={rig} onReady={markReady} {...looks.bottom} />}
      <Shoes rig={rig} onReady={markReady} />
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

function BodyModel({ url, glasses }: { url: string; glasses: boolean }) {
  const gltf = useGLTF(url);
  const [revealed, setRevealed] = useState(false); // sticky: hidden until first fully dressed
  const setDressed = useFit((s) => s.setDressed);
  const reveal = useCallback(() => {
    setRevealed(true);
    setDressed(true);
  }, [setDressed]);
  useEffect(() => {
    const t = setTimeout(reveal, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [reveal]);
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
      <primitive object={gltf.scene} visible={revealed} />
      {rig && <Outfit rig={rig} onDressed={reveal} />}
      {rig && glasses && <Glasses rig={rig} />}
    </group>
  );
}

export function Avatar() {
  const model = useFit((s) => s.model);
  const config = MODELS[model];
  const status = useAssetAvailable(config.bodyUrl);
  const heightCm = useFit((s) => s.heightCm);
  const scale = heightCm / config.baseHeightCm;
  usePreloadGarments(model);
  return (
    <group scale={scale}>
      {status === 'ok' && (
        <AssetBoundary key={model} name={config.bodyUrl} fallback={<PlaceholderBody />}>
          <Suspense fallback={null}>
            <BodyModel url={config.bodyUrl} glasses={config.glasses} />
          </Suspense>
        </AssetBoundary>
      )}
      {status === 'missing' && <PlaceholderBody />}
    </group>
  );
}
