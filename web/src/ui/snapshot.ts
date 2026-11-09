// Captures the viewer for /api/photoreal: centre 2:3 portrait, long side ≤ 1024px, JPEG 0.85.

export const MAX_SIDE = 1024;
const ASPECT = 2 / 3; // width / height; matches the 1024x1536 portrait requested from the image model
const JPEG_QUALITY = 0.85;
const MATTE = '#FFFFFF'; // under the render, so any transparent pixel becomes paper instead of black

export interface PortraitCrop {
  sx: number;
  sw: number;
  sh: number;
  outW: number;
  outH: number;
}

/** Where to crop a srcW x srcH canvas, and the output size (never upscaled). */
export function portraitCrop(srcW: number, srcH: number): PortraitCrop {
  if (srcW <= 0 || srcH <= 0) throw new Error('The 3D view has no size yet.');
  const sh = srcH;
  const sw = Math.min(srcW, Math.round(sh * ASPECT));
  const sx = Math.round((srcW - sw) / 2);
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  return { sx, sw, sh, outW: Math.round(sw * scale), outH: Math.round(sh * scale) };
}

/** Crops the centre portrait of the viewer canvas (where the avatar stands) and returns a JPEG data URL. */
export function snapshotPortrait(source: HTMLCanvasElement): string {
  const { sx, sw, sh, outW, outH } = portraitCrop(source.width, source.height);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = MATTE;
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(source, sx, 0, sw, sh, 0, 0, outW, outH);
  return out.toDataURL('image/jpeg', JPEG_QUALITY);
}
