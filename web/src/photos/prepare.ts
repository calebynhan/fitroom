// Shopper photos are decoded and downscaled in the browser (EXIF orientation applied), re-encoded as JPEG, and kept
// in memory only: never written to storage, never kept by the server.
import { MAX_PHOTO_CHARS } from '@api/look';

export type PhotoSlot = 'front' | 'side' | 'face';
export const PHOTO_SLOTS: PhotoSlot[] = ['front', 'side', 'face'];

export const PHOTO_GUIDE: Record<PhotoSlot, { label: string; hint: string; maxSide: number }> = {
  front: { label: 'Front', hint: 'Full body, facing the camera', maxSide: 1024 },
  side: { label: 'Side', hint: 'Full body, turned sideways', maxSide: 1024 },
  face: { label: 'Face', hint: 'Left profile, close up', maxSide: 768 },
};

export interface PreparedPhoto {
  dataUrl: string;
  width: number;
  height: number;
}

export class PhotoError extends Error {}

const MIN_SHORT_SIDE = 320;
const QUALITIES = [0.86, 0.74, 0.6];

/** Output size for a w x h image whose long side may be at most maxSide (never upscaled). */
export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decodeBlob(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>, which some browsers decode more formats with
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new PhotoError("Couldn't open that photo. Try a JPEG or PNG."));
    img.src = src;
  });
}

function encode(decoded: Decoded, maxSide: number): PreparedPhoto {
  const { width, height } = fitWithin(decoded.width, decoded.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('This browser cannot process photos.');
  ctx.fillStyle = '#FFFFFF'; // transparent PNG pixels become white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(decoded.source, 0, 0, width, height);
  for (const q of QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    if (dataUrl.length <= MAX_PHOTO_CHARS) return { dataUrl, width, height };
  }
  throw new PhotoError('That photo is too detailed to send. Try another one.');
}

/** Reads a chosen file into a downscaled JPEG data URL. Throws PhotoError with a message for the shopper. */
export async function preparePhoto(file: File, slot: PhotoSlot): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('That file is not a photo.');
  let decoded: Decoded;
  try {
    decoded = await decodeBlob(file);
  } catch (err: unknown) {
    throw err instanceof PhotoError ? err : new PhotoError("Couldn't open that photo. Try a JPEG or PNG.");
  }
  try {
    if (Math.min(decoded.width, decoded.height) < MIN_SHORT_SIDE) {
      throw new PhotoError(`That photo is too small. Use one at least ${MIN_SHORT_SIDE} px on its short side.`);
    }
    return encode(decoded, PHOTO_GUIDE[slot].maxSide);
  } finally {
    decoded.close();
  }
}

/** Re-encodes a data URL (e.g. the finished front shot) at most maxSide on its long side. */
export async function downscaleDataUrl(dataUrl: string, maxSide: number): Promise<string> {
  const img = await loadImage(dataUrl);
  return encode({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined }, maxSide).dataUrl;
}
