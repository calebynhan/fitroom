// Simple A-pose mannequin (1.78 m) shown until web/public/models/body.glb exists.
// Torso/legs take the selected top/bottom colours so the picker is testable early.
import { useOutfitLooks } from './useOutfitLooks';

const SKIN = '#c9a08a';

interface LimbProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  radius: number;
  length: number;
  color: string;
}

function Limb({ position, rotation = [0, 0, 0], radius, length, color }: LimbProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <capsuleGeometry args={[radius, length, 8, 16]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

export function PlaceholderBody() {
  const looks = useOutfitLooks();
  const top = looks.top?.hex ?? SKIN;
  const bottom = looks.bottom?.hex ?? SKIN;
  return (
    <group>
      <mesh position={[0, 1.65, 0]} castShadow>
        <sphereGeometry args={[0.105, 32, 16]} />
        <meshStandardMaterial color={SKIN} roughness={0.6} />
      </mesh>
      <Limb position={[0, 1.52, 0]} radius={0.045} length={0.06} color={SKIN} />
      <Limb position={[0, 1.24, 0]} radius={0.155} length={0.3} color={top} />
      <Limb position={[0, 0.98, 0]} radius={0.15} length={0.08} color={bottom} />
      <Limb position={[-0.09, 0.5, 0]} radius={0.068} length={0.74} color={bottom} />
      <Limb position={[0.09, 0.5, 0]} radius={0.068} length={0.74} color={bottom} />
      <Limb position={[-0.28, 1.18, 0]} rotation={[0, 0, -0.38]} radius={0.048} length={0.52} color={top} />
      <Limb position={[0.28, 1.18, 0]} rotation={[0, 0, 0.38]} radius={0.048} length={0.52} color={top} />
    </group>
  );
}
