import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { publishAngle, takeCommands } from './viewerBus';

const TURN_EASE = 6; // higher = snappier
const DEG = Math.PI / 180;

/** Applies rotate/reset commands from the DOM and reports the current azimuth (degrees, 0 = front). */
export function CameraRig() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const remaining = useRef(0); // radians still to turn
  const lastPublished = useRef<number | null>(null);

  useFrame((_, delta) => {
    if (!controls) return;
    const cmd = takeCommands();
    if (cmd.reset) {
      remaining.current = -controls.getAzimuthalAngle();
    }
    remaining.current += cmd.turn * DEG;
    if (Math.abs(remaining.current) > 1e-4) {
      const step = remaining.current * Math.min(1, delta * TURN_EASE);
      controls.setAzimuthalAngle(controls.getAzimuthalAngle() + step);
      remaining.current -= step;
      controls.update();
    }
    const degrees = Math.round((((controls.getAzimuthalAngle() / DEG) % 360) + 360) % 360) % 360;
    if (degrees !== lastPublished.current) {
      lastPublished.current = degrees;
      publishAngle(degrees);
    }
  });

  return null;
}
