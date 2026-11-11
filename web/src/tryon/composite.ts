// Sharper results. The try-on model returns ~486x864 and redraws only the clothes, so wherever it changed nothing (the
// head and hair, the legs under a new top, the wall beside the person, the floor) the shopper's own photo is used at
// full resolution, and the model's output only where the clothes changed. The changed region is found by comparing
// the two images, then made solid row by row: from the leftmost to the rightmost change in each row (smoothed over
// neighbouring rows, widened by a margin), between the first and last changed rows. Never pixel by pixel: dark pants
// over dark jeans barely differ in pixels, and a per-pixel blend mixed old and new garments. Inside the region the
// model's output is used whole, so the garment always comes from the model.

/**
 * Changed (3x3 mean of the largest channel difference). 24 covers a new garment solidly on the owner's photos; 40
 * left holes in it, 16 started catching sand and wall texture the model barely touched (tested 2026-11-11).
 */
export const CHANGED = 24;
/** A row counts as garment when this share of it changed (at least 3 px), for 3 rows running. */
const ROW_SHARE = 0.01;
/** Margins around the changed region and the width of the fade at its edge (shares of the width / height). */
const MARGIN = 0.012;
const SIDE_MARGIN = 0.03;
const FEATHER = 0.012;
/** Spans are smoothed over this share of the height, so the edge follows the body, not every fold. */
const SMOOTH = 0.03;
/** A change counts toward a row's span only where it's dense: this many of the 9 px around it changed. */
const DENSE = 5;
/** Nothing to gain when the region covers nearly the whole photo. */
const MAX_AREA = 0.95;
/** Unsharp mask on the enlarged model output: strength and radius (px of the photo). */
export const SHARPEN = { amount: 0.5, radius: 2 }; // 1.0 left halos at the shoulders (tested 2026-11-11)

/** 1 where the try-on changed the photo noticeably (3x3 mean of the largest channel difference over CHANGED). */
export function changedMask(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, threshold = CHANGED): Uint8Array {
  const diff = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const k = i * 4;
    diff[i] = Math.max(Math.abs(before[k] - after[k]), Math.abs(before[k + 1] - after[k + 1]), Math.abs(before[k + 2] - after[k + 2]));
  }
  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) s += diff[(y + dy) * width + x + dx];
      if (s / 9 > threshold) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Changed pixels per row. */
export function changedPerRow(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number): number[] {
  return rowCounts(changedMask(before, after, width, height), width, height);
}

function rowCounts(mask: Uint8Array, width: number, height: number): number[] {
  const rows = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rows[y] += mask[y * width + x];
  return rows;
}

const garmentRow = (rows: number[], y: number, need: number) => rows[y] >= need && rows[y + 1] >= need && rows[y + 2] >= need;

/** The first row of the new garment, as a share of the height, or null when nothing changed. */
export function garmentTop(rows: number[], width: number): number | null {
  const need = Math.max(3, Math.round(width * ROW_SHARE));
  for (let y = 0; y < rows.length - 2; y += 1) if (garmentRow(rows, y, need)) return y / rows.length;
  return null;
}

/** Where the garment changed the photo: per row, the span [left, right] in pixels, or null outside it. */
export interface Region {
  top: number;
  bottom: number;
  spans: ([number, number] | null)[];
}

/** The changed region, made solid (see the header), in the result's pixels; null when nothing changed. */
export function garmentRegion(mask: Uint8Array, width: number, height: number): Region | null {
  const rows = rowCounts(mask, width, height);
  const need = Math.max(3, Math.round(width * ROW_SHARE));
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height - 2; y += 1) if (garmentRow(rows, y, need)) { top = y; break; }
  for (let y = height - 3; y >= 0; y -= 1) if (garmentRow(rows, y, need)) { bottom = y + 2; break; }
  if (top < 0 || bottom < top) return null;

  // dense changes only, so stray specks far from the body don't stretch a row's span
  const dense = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        if (xx >= 0 && xx < width) n += mask[yy * width + xx];
      }
    }
    return n >= DENSE;
  };
  const raw: ([number, number] | null)[] = new Array(height).fill(null);
  for (let y = top; y <= bottom; y += 1) {
    if (rows[y] < need) continue;
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) if (mask[y * width + x] && dense(x, y)) { left = x; break; }
    for (let x = width - 1; x >= 0; x -= 1) if (mask[y * width + x] && dense(x, y)) { right = x; break; }
    if (left >= 0 && right >= left) raw[y] = [left, right];
  }

  // smooth over neighbouring rows (widest wins), which also fills rows inside the garment where little changed
  const k = Math.max(2, Math.round(height * SMOOTH));
  const margin = Math.round(width * SIDE_MARGIN);
  const spans: ([number, number] | null)[] = new Array(height).fill(null);
  for (let y = top; y <= bottom; y += 1) {
    let left = Infinity;
    let right = -Infinity;
    for (let j = Math.max(top, y - k); j <= Math.min(bottom, y + k); j += 1) {
      const s = raw[j];
      if (s) {
        left = Math.min(left, s[0]);
        right = Math.max(right, s[1]);
      }
    }
    // a gap longer than the window inside the garment: keep the whole row (never show the old garment)
    spans[y] = Number.isFinite(left) ? [Math.max(0, left - margin), Math.min(width - 1, right + margin)] : [0, width - 1];
  }
  return { top, bottom, spans };
}

/**
 * How much of the model's output to use per pixel (0..1, row-major, result resolution): 1 inside the region and its
 * margin, fading to 0 over FEATHER. Separable box blur, so it needs no canvas filter (Safari has none).
 */
export function regionAlpha(region: Region, width: number, height: number): Float32Array {
  const alpha = new Float32Array(width * height);
  const vMargin = Math.round(height * MARGIN);
  for (let y = 0; y < height; y += 1) {
    // rows above / below the region take the nearest span, so the margin keeps the garment's width
    const src = y < region.top ? region.top : y > region.bottom ? region.bottom : y;
    if (y < region.top - vMargin || y > region.bottom + vMargin) continue;
    const span = region.spans[src];
    if (!span) continue;
    for (let x = span[0]; x <= span[1]; x += 1) alpha[y * width + x] = 1;
  }
  const r = Math.max(1, Math.round((FEATHER * height) / 2));
  return boxBlur(boxBlur(alpha, width, height, r), width, height, r);
}

function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const n = 2 * r + 1;
  for (let y = 0; y < height; y += 1) {
    let s = 0;
    for (let x = -r; x <= r; x += 1) s += src[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      tmp[y * width + x] = s / n;
      s += src[y * width + Math.min(width - 1, x + r + 1)] - src[y * width + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let s = 0;
    for (let y = -r; y <= r; y += 1) s += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = s / n;
      s += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/** Bounding box of alpha > 0, scaled to the photo's pixels (null when empty). */
function alphaBox(alpha: Float32Array, width: number, height: number, scale: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] <= 0) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  const x = Math.floor(x0 * scale);
  const y = Math.floor(y0 * scale);
  return { x, y, w: Math.ceil((x1 + 1) * scale) - x, h: Math.ceil((y1 + 1) * scale) - y };
}

/**
 * Unsharp mask on RGB, in place: v + amount * (v - blur(v)), blur = box blur of `radius` twice (roughly Gaussian).
 * The model's output is enlarged ~1.8x to the photo's size; this brings its edges closer to the sharp photo around it.
 */
export function unsharp(data: Uint8ClampedArray, width: number, height: number, radius: number, amount: number): void {
  if (amount <= 0 || radius < 1) return;
  const channel = new Float32Array(width * height);
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < width * height; i += 1) channel[i] = data[i * 4 + c];
    const blurred = boxBlur(boxBlur(channel, width, height, radius), width, height, radius);
    for (let i = 0; i < width * height; i += 1) data[i * 4 + c] = channel[i] + amount * (channel[i] - blurred[i]);
  }
}

/** Same framing (the Space keeps the aspect ratio; anything else means it cropped and can't be lined up). */
export function sameFraming(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) < 0.01;
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return [c, ctx];
}

async function decode(src: Blob | string): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob);
}

/**
 * The try-on result at the photo's own resolution: the model's output where the clothes changed, the shopper's photo
 * everywhere else. Falls back to the model's result (as a data URL) when the two can't be lined up or nothing changed.
 */
export async function sharpenResult(photo: string, result: Blob, fallback: string): Promise<string> {
  let original: ImageBitmap | null = null;
  let output: ImageBitmap | null = null;
  try {
    [original, output] = await Promise.all([decode(photo), decode(result)]);
    const W = output.width;
    const H = output.height;
    const OW = original.width;
    const OH = original.height;
    if (!sameFraming({ width: W, height: H }, { width: OW, height: OH }) || OW <= W) return fallback;

    const [, small] = canvas(W, H);
    small.drawImage(original, 0, 0, W, H);
    const [, out] = canvas(W, H);
    out.drawImage(output, 0, 0);
    const region = garmentRegion(changedMask(small.getImageData(0, 0, W, H).data, out.getImageData(0, 0, W, H).data, W, H), W, H);
    if (!region) return fallback;
    const alpha = regionAlpha(region, W, H);
    let area = 0;
    for (const a of alpha) area += a;
    if (area / (W * H) > MAX_AREA) return fallback;

    // the shopper's photo, kept where alpha is low: its own alpha is 1 - the model's, drawn over the model's output
    const [keep, k] = canvas(W, H);
    const mask = k.createImageData(W, H);
    for (let i = 0; i < W * H; i += 1) mask.data[i * 4 + 3] = Math.round(255 * (1 - alpha[i]));
    k.putImageData(mask, 0, 0);
    const [final, f] = canvas(OW, OH);
    f.imageSmoothingQuality = 'high';
    f.drawImage(output, 0, 0, OW, OH);
    const box = alphaBox(alpha, W, H, OW / W);
    if (SHARPEN.amount > 0 && box) {
      const enlarged = f.getImageData(box.x, box.y, box.w, box.h);
      unsharp(enlarged.data, box.w, box.h, SHARPEN.radius, SHARPEN.amount);
      f.putImageData(enlarged, box.x, box.y);
    }
    const [photoLayer, p] = canvas(OW, OH);
    p.drawImage(original, 0, 0);
    p.globalCompositeOperation = 'destination-in';
    p.imageSmoothingQuality = 'high';
    p.drawImage(keep, 0, 0, OW, OH);
    f.drawImage(photoLayer, 0, 0);
    return final.toDataURL('image/jpeg', 0.92);
  } catch (err: unknown) {
    console.warn('[tryon] kept the model result unsharpened', err);
    return fallback;
  } finally {
    original?.close();
    output?.close();
  }
}
