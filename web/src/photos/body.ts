// Where the shopper's body is in their photo, found on the device: MediaPipe's pose model (Apache-2.0) runs in the
// browser, so the photo never leaves it for this. The try-on uses it to send the model only the part being dressed
// (tryon/frame.ts): the model works at a fixed 576x864, and a full-length photo gives the clothes too few of those pixels
// to draw fabric texture. The model and the WASM runtime are served from this site (about 9 MB, loaded once and cached
// by the browser) and only after a front photo is added. Every failure means "no landmarks": the try-on then sends the
// whole photo, as it did before.
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

/** One of MediaPipe's 33 pose landmarks: x, y as shares of the photo's width / height, v = visibility (0..1). */
export interface BodyPoint {
  x: number;
  y: number;
  v: number;
}
export type Body = BodyPoint[];

const MODEL_URL = '/pose/pose_landmarker_lite.task';
/** The photos last looked at (front, side, a replaced one): landmarks are small, the photos aren't kept here. */
const CACHE = 3;

let landmarker: Promise<PoseLandmarker> | null = null;
const found = new Map<string, Promise<Body | null>>();

function load(): Promise<PoseLandmarker> {
  if (!landmarker) {
    landmarker = import('@mediapipe/tasks-vision')
      .then(({ PoseLandmarker }) =>
        PoseLandmarker.createFromOptions(
          { wasmLoaderPath, wasmBinaryPath },
          // CPU: the GPU delegate fails on some phones, and one photo takes well under a second either way
          { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1 },
        ),
      )
      .catch((err: unknown) => {
        landmarker = null; // a dropped download can be tried again with the next photo
        throw err;
      });
  }
  return landmarker;
}

async function detect(photo: string): Promise<Body | null> {
  const model = await load();
  const bitmap = await createImageBitmap(await (await fetch(photo)).blob());
  try {
    const points = model.detect(bitmap).landmarks[0];
    return points?.length === 33 ? points.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })) : null;
  } finally {
    bitmap.close();
  }
}

/** The body's landmarks in `photo` (a data URL), or null when there is no clear body or the model can't run. Never rejects. */
export function bodyOf(photo: string): Promise<Body | null> {
  let body = found.get(photo);
  if (!body) {
    body = detect(photo).catch((err: unknown) => {
      console.warn('[body] no landmarks; the try-on sends the whole photo', err);
      found.delete(photo);
      return null;
    });
    found.set(photo, body);
    while (found.size > CACHE) found.delete(found.keys().next().value!);
  }
  return body;
}

/** Looks for the body ahead of the try-on (after a front photo is added), unless the browser asked to save data. */
export function prefetchBody(photo: string): void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  const start = () => void bodyOf(photo);
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 500);
}

/** Forgets landmarks of photos no longer on screen. */
export function keepBodies(photos: string[]): void {
  for (const key of found.keys()) if (!photos.includes(key)) found.delete(key);
}
