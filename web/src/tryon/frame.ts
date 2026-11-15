// What the try-on model is shown. It works at a fixed 576x864 (2:3), with 12 px patches: a full-length photo leaves the
// chest about 150 px wide there, too few pixels to draw knit, waffle or denim, and UNIQLO's garment-only shots leave a
// wide white margin around the garment. So the model gets, at its own 2:3 shape:
// - the shopper's photo cropped to the part being dressed (head to mid-thigh for a top, chest to the floor for bottoms),
//   from body landmarks found on the device (photos/body.ts); composite.ts puts the result back into the full photo;
// - the garment photo cropped to the garment and padded with its own backdrop.
// Measured on the Space (2026-11-14, 9 passes): fine detail in the same patch of the body 2.3x (Milano Ribbed Sweater,
// which also got back its rib hem, cuffs and collar band), 1.6x (Waffle T) and 2.1x (jeans). Without landmarks, or
// when a crop would gain little, the whole photo is sent as before.
import type { Body, BodyPoint } from '../photos/body';
import type { TryOnCategory } from './space';

/** A rectangle in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The model's working size (FASHN VTON v1.5): width x height. */
const MODEL_W = 576;
const MODEL_H = 864;
/** A landmark counts when the model is at least this sure it's visible. */
const VISIBLE = 0.5;
/** Crop only when the model gets at least this much more resolution on the body than with the whole photo. */
export const MIN_GAIN = 1.15;

const NOSE = 0;
const EARS = [7, 8];
const SHOULDERS = [11, 12];
const ELBOWS = [13, 14];
const WRISTS = [15, 16];
const HANDS = [17, 18, 19, 20, 21, 22];
const HIPS = [23, 24];
const KNEES = [25, 26];
const FEET = [27, 28, 29, 30, 31, 32]; // ankles, heels, toes

/** Scale the Space applies to fit an image of this size into 576x864. */
const fitScale = (w: number, h: number) => Math.min(MODEL_W / w, MODEL_H / h);

/** `box` grown to 2:3 around its centre, then kept inside the image (where the image is too small, it stays narrower). */
export function grow23(box: Box, width: number, height: number): Box {
  let { w, h } = box;
  if (w / h > 2 / 3) h = w * 1.5;
  else w = (h * 2) / 3;
  w = Math.min(Math.round(w), width);
  h = Math.min(Math.round(h), height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), width - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), height - h));
  return { x, y, w, h };
}

/**
 * The part of a photo to send for `category`, in the photo's pixels, or null for the whole photo (no clear body, or a
 * crop that would gain little). Margins are generous: composite.ts fades back to the photo at a crop's inner edges, so
 * a garment that reached past the crop would show the old one beyond it.
 */
export function personBox(body: Body | null, category: TryOnCategory, width: number, height: number): Box | null {
  if (!body || body.length !== 33 || width < 64 || height < 64) return null;
  const at = (i: number): BodyPoint & { px: number; py: number } => ({ ...body[i], px: body[i].x * width, py: body[i].y * height });
  const seen = (ids: number[]) => ids.map(at).filter((p) => p.v >= VISIBLE);
  const shoulders = seen(SHOULDERS);
  const hips = seen(HIPS);
  if (shoulders.length < 2 || hips.length < 2) return null;
  const mean = (ps: { py: number }[]) => ps.reduce((s, p) => s + p.py, 0) / ps.length;
  const shoulderY = mean(shoulders);
  const hipY = mean(hips);
  const torso = hipY - shoulderY;
  if (torso < height * 0.08) return null; // tiny, lying down or upside down: not a photo to crop
  const shoulderWidth = Math.abs(shoulders[0].px - shoulders[1].px);
  const maxY = (ps: { py: number }[]) => Math.max(...ps.map((p) => p.py));
  const knees = seen(KNEES);
  const hands = seen([...WRISTS, ...HANDS]);

  let top: number;
  let bottom: number;
  let sides: BodyPoint[];
  let margin: number;
  if (category === 'tops') {
    // the whole head (the model places the neckline from it), down to mid-thigh: below any top's hem and the old one's
    const nose = at(NOSE);
    top = nose.v >= VISIBLE && nose.py < shoulderY ? nose.py - 1.25 * (shoulderY - nose.py) : shoulderY - 0.95 * torso;
    bottom = knees.length ? hipY + 0.7 * (mean(knees) - hipY) : hipY + 0.6 * torso;
    if (hands.length) bottom = Math.max(bottom, maxY(hands) + 0.15 * torso);
    sides = seen([...EARS, ...SHOULDERS, ...ELBOWS, ...WRISTS, ...HANDS, ...HIPS]);
    margin = 0.35;
  } else {
    // from the chest (the top's hem and the waistband are both well inside) to below the feet
    top = shoulderY + 0.45 * torso;
    const feet = seen(FEET);
    bottom = feet.length ? maxY(feet) + 0.15 * torso : height;
    sides = seen([...HIPS, ...KNEES, ...FEET, ...WRISTS, ...HANDS]);
    margin = 0.3;
  }
  const pad = Math.max(width * 0.04, margin * shoulderWidth);
  const left = Math.min(...sides.map((p) => p.x * width)) - pad;
  const right = Math.max(...sides.map((p) => p.x * width)) + pad;
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
  const x0 = clamp(left, width);
  const x1 = clamp(right, width);
  const y0 = clamp(top, height);
  const y1 = clamp(bottom, height);
  if (x1 - x0 < 32 || y1 - y0 < 32) return null;
  const box = grow23({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, width, height);
  if (fitScale(box.w, box.h) / fitScale(width, height) < MIN_GAIN) return null;
  return box;
}

/** Garment photo framing: the crop of the photo and where it sits on a 2:3 canvas filled with the backdrop. */
export interface GarmentFrame {
  crop: Box;
  canvas: { w: number; h: number };
  at: { x: number; y: number };
  backdrop: [number, number, number];
}

/** A channel this far from the backdrop is garment; the four corners this close to each other are a plain backdrop. */
const OFF_BACKDROP = 20;
const PLAIN = 20;

/**
 * Where the garment is on a product photo with a plain backdrop (pixels of a small copy, RGBA), as a box in those pixels,
 * plus the backdrop colour; null when the corners disagree (no plain backdrop) or nothing stands out.
 */
export function garmentBounds(px: Uint8ClampedArray, width: number, height: number): { box: Box; backdrop: [number, number, number] } | null {
  const at = (x: number, y: number, k: number) => px[(y * width + x) * 4 + k];
  const corners = [
    [1, 1],
    [width - 2, 1],
    [1, height - 2],
    [width - 2, height - 2],
  ].map(([x, y]) => [0, 1, 2].map((k) => at(x, y, k)));
  const backdrop = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4) as [number, number, number];
  if (corners.some((c) => c.some((v, k) => Math.abs(v - backdrop[k]) > PLAIN))) return null;
  const cols = new Array<number>(width).fill(0);
  const rows = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.max(...[0, 1, 2].map((k) => Math.abs(at(x, y, k) - backdrop[k]))) > OFF_BACKDROP) {
        cols[x] += 1;
        rows[y] += 1;
      }
    }
  }
  // a column / row counts with a few garment pixels in it, so JPEG specks don't stretch the box
  const minCol = Math.max(2, Math.round(height * 0.01));
  const minRow = Math.max(2, Math.round(width * 0.01));
  const x0 = cols.findIndex((c) => c >= minCol);
  const y0 = rows.findIndex((c) => c >= minRow);
  if (x0 < 0 || y0 < 0) return null;
  const x1 = width - 1 - [...cols].reverse().findIndex((c) => c >= minCol);
  const y1 = height - 1 - [...rows].reverse().findIndex((c) => c >= minRow);
  return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, backdrop };
}

/**
 * The garment photo's framing at full size (`box` in its pixels, from garmentBounds scaled up): the garment plus a 3%
 * margin, centred on a 2:3 canvas. Null when the garment already fills the photo (nothing to gain).
 */
export function garmentFrame(box: Box, width: number, height: number, backdrop: [number, number, number]): GarmentFrame | null {
  const mx = Math.max(6, Math.round(box.w * 0.03));
  const my = Math.max(6, Math.round(box.h * 0.03));
  const x = Math.max(0, box.x - mx);
  const y = Math.max(0, box.y - my);
  const crop = { x, y, w: Math.min(width, box.x + box.w + mx) - x, h: Math.min(height, box.y + box.h + my) - y };
  const canvas = crop.w / crop.h > 2 / 3 ? { w: crop.w, h: Math.round(crop.w * 1.5) } : { w: Math.round((crop.h * 2) / 3), h: crop.h };
  // the garment's size at the model's resolution, framed vs as photographed
  if (fitScale(canvas.w, canvas.h) / fitScale(width, height) < MIN_GAIN) return null;
  return { crop, canvas, at: { x: Math.round((canvas.w - crop.w) / 2), y: Math.round((canvas.h - crop.h) / 2) }, backdrop };
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return [c, ctx];
}

function toJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the crop'))), 'image/jpeg', 0.95));
}

/** `box` of an image (data URL or blob) as a JPEG, at its own resolution (the Space resizes with Lanczos / area). */
export async function cropImage(src: string | Blob, box: Box): Promise<Blob> {
  const bitmap = await createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src);
  try {
    const [c, ctx] = canvas2d(box.w, box.h);
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return await toJpeg(c);
  } finally {
    bitmap.close();
  }
}

/** Width x height of an image (data URL or blob). */
export async function imageSize(src: string | Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** The garment photo cropped to the garment on a 2:3 canvas of its backdrop; the photo itself when that gains little. */
export async function frameGarment(photo: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(photo);
    try {
      const W = bitmap.width;
      const H = bitmap.height;
      const sw = 150;
      const sh = Math.max(2, Math.round((H / W) * sw));
      const [, small] = canvas2d(sw, sh);
      small.drawImage(bitmap, 0, 0, sw, sh);
      const found = garmentBounds(small.getImageData(0, 0, sw, sh).data, sw, sh);
      if (!found) return photo;
      const sx = W / sw;
      const sy = H / sh;
      const box = { x: Math.floor(found.box.x * sx), y: Math.floor(found.box.y * sy), w: Math.ceil(found.box.w * sx), h: Math.ceil(found.box.h * sy) };
      const frame = garmentFrame(box, W, H, found.backdrop);
      if (!frame) return photo;
      const [c, ctx] = canvas2d(frame.canvas.w, frame.canvas.h);
      ctx.fillStyle = `rgb(${frame.backdrop.map(Math.round).join(',')})`;
      ctx.fillRect(0, 0, frame.canvas.w, frame.canvas.h);
      ctx.drawImage(bitmap, frame.crop.x, frame.crop.y, frame.crop.w, frame.crop.h, frame.at.x, frame.at.y, frame.crop.w, frame.crop.h);
      return await toJpeg(c);
    } finally {
      bitmap.close();
    }
  } catch (err: unknown) {
    console.warn('[tryon] sent the garment photo unframed', err);
    return photo;
  }
}
