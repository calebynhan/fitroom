// Tiny bridge between DOM controls (outside <Canvas>) and the camera rig (inside it).

type AngleListener = (degrees: number) => void;

let pendingTurn = 0; // degrees to add to the azimuth
let resetRequested = false;
const angleListeners = new Set<AngleListener>();

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
  angleListeners.forEach((fn) => fn(degrees));
}

export function onAngle(fn: AngleListener): () => void {
  angleListeners.add(fn);
  return () => {
    angleListeners.delete(fn);
  };
}
