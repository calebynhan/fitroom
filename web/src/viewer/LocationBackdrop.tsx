import { useEnvironment } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GroundedSkybox } from 'three/examples/jsm/objects/GroundedSkybox.js';

interface LocationBackdropProps {
  hdri: string;
  /** Height (m) of the camera that captured the HDRI. */
  height: number;
  /** Radius (m) of the projected floor before it curves into the sky dome. */
  radius: number;
  intensity: number;
}

/** Sharp, ground-projected photo of a real location: the avatar stands on the photographed floor at y = 0. */
export function LocationBackdrop({ hdri, height, radius, intensity }: LocationBackdropProps) {
  const texture = useEnvironment({ files: hdri });
  const skybox = useMemo(() => {
    const mesh = new GroundedSkybox(texture, height, radius);
    mesh.position.y = height - 0.01;
    return mesh;
  }, [texture, height, radius]);

  useEffect(() => {
    (skybox.material as THREE.MeshBasicMaterial).color.setScalar(intensity);
  }, [skybox, intensity]);

  useEffect(
    () => () => {
      skybox.geometry.dispose();
      (skybox.material as THREE.Material).dispose();
    },
    [skybox],
  );

  return <primitive object={skybox} />;
}
