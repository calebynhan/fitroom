// The garment photo the try-on model copies. UNIQLO's catalogue photo (usgoods_*) shows the garment on a model, with
// that model's styling: an undershirt under a sweater, a tee tucked into a belt, a jacket over the pants. The model
// copies all of it (tested 2026-11-10 on the shopper's own photos). Most items also have a garment-only shot
// (WesternCommon goods_*): the garment alone on a plain backdrop, which the try-on reproduces without the styling and
// with truer colour. Some goods_ shots are model shots too, so each photo is checked before choosing its photo type.

import type { GarmentPhotoType } from './space';

export interface GarmentPhoto {
  blob: Blob;
  type: GarmentPhotoType;
  /** The same-site URL it came from (shown as the colour reference). */
  url: string;
}

/**
 * The garment-only shot for a catalogue photo, if the URL follows UNIQLO's pattern:
 * /uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg
 *   -> /uniqlo/UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg
 */
export function garmentOnlyUrl(url: string): string | null {
  const m = url.match(/^(.*\/UQ\/ST3\/)us(\/imagesgoods\/\d+\/item\/)usgoods_([A-Za-z0-9]+_\d+_3x4\.jpg)$/);
  return m ? `${m[1]}WesternCommon${m[2]}goods_${m[3]}` : null;
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

const MODEL_COVERAGE = 0.05;

async function photoType(blob: Blob): Promise<GarmentPhotoType> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'model';
    ctx.drawImage(bitmap, 0, 0, 60, 80);
    return topCentreCoverage(ctx.getImageData(0, 0, 60, 80).data, 60, 80) > MODEL_COVERAGE ? 'model' : 'flat-lay';
  } finally {
    bitmap.close();
  }
}

async function fetchImage(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return await res.blob();
  } catch {
    return null;
  }
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
