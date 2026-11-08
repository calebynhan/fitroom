// Tiny bridge between DOM controls (outside <Canvas>) and the camera rig (inside it).

type AngleListener = (degrees: number) => void;

let pendingTurn = 0; // degrees to add to the azimuth
let resetRequested = false;
let lastAngle = 0;
const angleListeners = new Set<AngleListener>();

const FRONT_TOLERANCE_DEG = 40;
const TURN_SETTLE_MS = 1200; // the rig eases in ~1 s

export function turnBy(degrees: number): void {
  pendingTurn += degrees;
}

export function resetView(): void {
  pendingTurn = 0;
  resetRequested = true;
}

/** Called by the rig each frame; returns and clears queued commands. */
export function takeCommands(): { turn: number; reset: boolean } {
  const out = { turn: pendingTurn, reset: resetRequested };
  pendingTurn = 0;
  resetRequested = false;
  return out;
}

export function publishAngle(degrees: number): void {
  lastAngle = degrees;
  angleListeners.forEach((fn) => fn(degrees));
}

/** Turns the camera back to the front view if it is facing away; resolves once the turn has settled. */
export function faceFront(): Promise<void> {
  const offFront = lastAngle > 180 ? 360 - lastAngle : lastAngle;
  if (offFront <= FRONT_TOLERANCE_DEG) return Promise.resolve();
  resetView();
  return new Promise((resolve) => {
    window.setTimeout(resolve, TURN_SETTLE_MS);
  });
}

export function onAngle(fn: AngleListener): () => void {
  angleListeners.add(fn);
  return () => {
    angleListeners.delete(fn);
  };
}
