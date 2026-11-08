import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

const GROUND_RADIUS = 9;
const FADE_TEXTURE_SIZE = 256;

/** Radial alpha so the floor melts into the backdrop instead of ending in a hard edge. */
function makeFadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FADE_TEXTURE_SIZE;
  canvas.height = FADE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = FADE_TEXTURE_SIZE / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#ffffff');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FADE_TEXTURE_SIZE, FADE_TEXTURE_SIZE);
  }
  return new THREE.CanvasTexture(canvas);
}

interface GroundProps {
  color: string;
  roughness: number;
}

export function Ground({ color, roughness }: GroundProps) {
  const alphaMap = useMemo(makeFadeTexture, []);
  useEffect(() => () => alphaMap.dispose(), [alphaMap]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <circleGeometry args={[GROUND_RADIUS, 64]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={0} alphaMap={alphaMap} transparent depthWrite={false} />
    </mesh>
  );
}
