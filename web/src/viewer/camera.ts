// Default framing: 3/4 front, slightly below eye level, full body in view.
export const DEFAULT_AZIMUTH_DEG = 25;
export const CAMERA_DISTANCE = 4.1; // full body fills ~80% of the viewer height
export const CAMERA_HEIGHT = 1.25;
export const CAMERA_TARGET: [number, number, number] = [0, 0.86, 0];

const az = (DEFAULT_AZIMUTH_DEG * Math.PI) / 180;
export const CAMERA_POSITION: [number, number, number] = [
  CAMERA_DISTANCE * Math.sin(az),
  CAMERA_HEIGHT,
  CAMERA_DISTANCE * Math.cos(az),
];
