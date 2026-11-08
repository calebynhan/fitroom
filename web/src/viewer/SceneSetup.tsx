import { ContactShadows, Environment, useEnvironment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { useFit } from '../state/store';
import { Ground } from './Ground';
import { LocationBackdrop } from './LocationBackdrop';
import { SCENE_IDS, SCENES } from './scenes';

const KEY_POSITION: [number, number, number] = [-2.5, 3.5, 3]; // front-left, soft
const RIM_POSITION: [number, number, number] = [3, 2.5, -3]; // behind-right
const PRELOAD_DELAY_MS = 2500;

/** Warm the other scenes' HDRIs after first paint so switching is instant. */
function usePreloadScenes(): void {
  useEffect(() => {
    const t = setTimeout(() => SCENE_IDS.forEach((id) => useEnvironment.preload({ files: SCENES[id].hdri })), PRELOAD_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
}

export function SceneSetup() {
  const sceneId = useFit((s) => s.scene);
  const preset = SCENES[sceneId];
  const scene = useThree((s) => s.scene);
  usePreloadScenes();

  // Solid backdrop for the studio; location scenes draw their own background.
  useEffect(() => {
    if (!preset.showBackground) scene.background = new THREE.Color(preset.backgroundColor);
  }, [scene, preset]);

  const projection = preset.groundProjection;
  return (
    <>
      <Suspense fallback={null}>
        <Environment
          key={sceneId}
          files={preset.hdri}
          background={preset.showBackground && !projection}
          backgroundBlurriness={preset.backgroundBlurriness}
          backgroundIntensity={preset.backgroundIntensity}
          environmentIntensity={preset.environmentIntensity}
        />
        {projection && (
          <LocationBackdrop
            key={`backdrop-${sceneId}`}
            hdri={preset.hdri}
            height={projection.height}
            radius={projection.radius}
            intensity={preset.backgroundIntensity}
          />
        )}
      </Suspense>
      <directionalLight position={KEY_POSITION} intensity={preset.keyLight} color={preset.keyColor} />
      <directionalLight position={RIM_POSITION} intensity={preset.rimLight} color={preset.rimColor} />
      {!projection && <Ground color={preset.groundColor} roughness={preset.groundRoughness} />}
      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} blur={2.5} far={1.5} scale={4} resolution={512} />
    </>
  );
}
