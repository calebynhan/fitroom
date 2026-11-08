import { ContactShadows, Environment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useFit } from '../state/store';
import { SCENES } from './scenes';

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
      <directionalLight position={[2.5, 4, 3]} intensity={preset.keyLight} color={preset.keyColor} />
      <directionalLight position={[-3, 2.5, -3]} intensity={preset.rimLight} color={preset.rimColor} />
      <ContactShadows position={[0, 0.001, 0]} opacity={preset.shadowOpacity} scale={4} blur={2.4} far={2} resolution={512} />
    </>
  );
}
