// The garment photo the try-on model copies. UNIQLO's catalogue photo (usgoods_*) shows the garment on a model, with
// that model's styling: an undershirt under a sweater, a tee tucked into a belt, a jacket over the pants. The model
// copies all of it (tested 2026-11-10 on the shopper's own photos). Most items also have a garment-only shot
// (WesternCommon goods_*): the garment alone on a plain backdrop, which the try-on reproduces without the styling and
// with truer colour. Some goods_ shots are model shots too, so each photo is checked before choosing its photo type.

import { garmentOnlyUrl } from '@api/fit/garmentPhoto';
import type { GarmentPhotoType } from './space';

export { garmentOnlyUrl };

export interface GarmentPhoto {
  blob: Blob;
  type: GarmentPhotoType;
  /** The same-site URL it came from (shown as the colour reference). */
  url: string;
}

/**
 * Share of the top-centre of the photo that isn't backdrop (0..1): a model's head sits there; a garment laid out
 * on its own starts lower. Measured on UNIQLO photos: garment-only 0%, model shots 20-59%.
 */
export function topCentreCoverage(pixels: Uint8ClampedArray, width: number, height: number): number {
  const at = (x: number, y: number, k: number) => pixels[(y * width + x) * 4 + k];
  const corners = [
    [1, 1],
    [width - 2, 1],
    [1, Math.floor(height * 0.1)],
    [width - 2, Math.floor(height * 0.1)],
  ];
  const backdrop = [0, 1, 2].map((k) => corners.reduce((s, [x, y]) => s + at(x, y, k), 0) / corners.length);
  let covered = 0;
  let total = 0;
  for (let y = 0; y < Math.floor(height * 0.15); y += 1) {
    for (let x = Math.floor(width * 0.3); x < Math.ceil(width * 0.7); x += 1) {
      total += 1;
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(at(x, y, k) - backdrop[k])));
      if (d > 30) covered += 1;
    }
  }
  return total ? covered / total : 0;
}

/**
 * Share of the upper-middle of the photo with skin tones that aren't backdrop (0..1). Garment-only photos of tall
 * pants put the waistband in the top-centre band too, so coverage alone misread 3/34 products; a model shot also shows
 * skin there (face, neck, arms: >= 2.1% on 42 model shots), while garments laid out alone show none unless they are
 * skin-coloured, which the coverage test already rules out (beige / brown flats start below the band).
 */
export function upperSkin(pixels: Uint8ClampedArray, width: number, height: number): number {
  const at = (x: number, y: number, k: number) => pixels[(y * width + x) * 4 + k];
  const backdrop = [0, 1, 2].map((k) => (at(1, 1, k) + at(width - 2, 1, k)) / 2);
  let skin = 0;
  let total = 0;
  for (let y = 0; y < Math.floor(height * 0.3); y += 1) {
    for (let x = Math.floor(width * 0.25); x < Math.ceil(width * 0.75); x += 1) {
      total += 1;
      const [r, g, b] = [at(x, y, 0), at(x, y, 1), at(x, y, 2)];
      const offBackdrop = Math.abs(r - backdrop[0]) + Math.abs(g - backdrop[1]) + Math.abs(b - backdrop[2]) > 40;
      if (offBackdrop && r > 95 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && Math.max(r, g, b) - Math.min(r, g, b) > 15) skin += 1;
    }
  }
  return total ? skin / total : 0;
}

const MODEL_COVERAGE = 0.05;
const MODEL_SKIN = 0.01;

/** Worn by a model: something sits where a head would be, and there is skin up there. 68/68 on UNIQLO photos. */
export function isModelShot(pixels: Uint8ClampedArray, width: number, height: number): boolean {
  return topCentreCoverage(pixels, width, height) > MODEL_COVERAGE && upperSkin(pixels, width, height) > MODEL_SKIN;
}

async function photoType(blob: Blob): Promise<GarmentPhotoType> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'model';
    ctx.drawImage(bitmap, 0, 0, 60, 80);
    return isModelShot(ctx.getImageData(0, 0, 60, 80).data, 60, 80) ? 'model' : 'flat-lay';
  } finally {
    bitmap.close();
  }
}

const FETCH_MS = 15_000;

/**
 * The image, or null when UNIQLO doesn't have it (404 / 403 / not an image). Network errors, timeouts and 5xx throw:
 * falling back to the styled catalogue photo then would be cached for the whole session.
 */
async function fetchImage(url: string): Promise<Blob | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
  if (res.status === 404 || res.status === 403 || res.status === 410) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
  return res.blob();
}

/** The best photo of a garment for the try-on: garment-only when UNIQLO has one, else the catalogue photo. */
export async function loadGarmentPhoto(url: string): Promise<GarmentPhoto | null> {
  const plain = garmentOnlyUrl(url);
  for (const candidate of plain ? [plain, url] : [url]) {
    const blob = await fetchImage(candidate);
    if (!blob) continue;
    let type: GarmentPhotoType = 'model';
    try {
      type = await photoType(blob);
    } catch {
      // can't inspect it: treat it as worn, the setting that copes with either
    }
    return { blob, type, url: candidate };
  }
  return null;
}
