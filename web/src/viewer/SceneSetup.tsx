import { ContactShadows, Environment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useFit } from '../state/store';
import { Ground } from './Ground';
import { SCENES } from './scenes';

const KEY_POSITION: [number, number, number] = [-2.5, 3.5, 3]; // front-left, soft
const RIM_POSITION: [number, number, number] = [3, 2.5, -3]; // behind-right

export function SceneSetup() {
  const sceneId = useFit((s) => s.scene);
  const preset = SCENES[sceneId];
  const scene = useThree((s) => s.scene);

  // Solid backdrop only for scenes that hide the HDRI; otherwise <Environment background> owns scene.background.
  useEffect(() => {
    if (!preset.showBackground) scene.background = new THREE.Color(preset.backgroundColor);
  }, [scene, preset]);

  return (
    <>
      <Environment
        key={sceneId}
        files={preset.hdri}
        background={preset.showBackground}
        backgroundBlurriness={preset.backgroundBlurriness}
        backgroundIntensity={preset.backgroundIntensity}
        environmentIntensity={preset.environmentIntensity}
      />
      <directionalLight position={KEY_POSITION} intensity={preset.keyLight} color={preset.keyColor} />
      <directionalLight position={RIM_POSITION} intensity={preset.rimLight} color={preset.rimColor} />
      <Ground color={preset.groundColor} roughness={preset.groundRoughness} />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} blur={2.5} far={1.5} scale={4} resolution={512} />
    </>
  );
}
