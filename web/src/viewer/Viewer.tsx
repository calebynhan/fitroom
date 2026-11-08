import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import { useFit } from '../state/store';
import { Avatar } from './Avatar';
import { CameraRig } from './CameraRig';
import { CAMERA_POSITION, CAMERA_TARGET } from './camera';
import { setViewerCanvas } from './canvasRef';
import { SceneSetup } from './SceneSetup';

const AUTO_ROTATE_SPEED = 0.6; // slow showroom spin

export function Viewer() {
  const autoRotate = useFit((s) => s.autoRotate);
  return (
    <Canvas
      className="viewer"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      camera={{ position: CAMERA_POSITION, fov: 30, near: 0.05, far: 100 }}
      onCreated={({ gl }) => setViewerCanvas(gl.domElement)}
    >
      <Suspense fallback={null}>
        <SceneSetup />
      </Suspense>
      <Avatar />
      <CameraRig />
      <OrbitControls
        makeDefault
        target={CAMERA_TARGET}
        autoRotate={autoRotate}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        enablePan={false}
        minDistance={1.6}
        maxDistance={7}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
    </Canvas>
  );
}
