// Sharper results: the try-on model returns ~486x864 and redraws only the clothes, so everything above the first
// changed garment (head, hair, glasses, the wall behind) is taken from the shopper's own photo at full resolution and
// the rest from the model. One horizontal cut, found where the new garment starts (the collar, or the waistband
// for bottoms): a per-pixel blend was tried and failed, because dark pants over dark jeans barely differ in pixels
// and old and new garments got mixed. Below the cut the model's output is used whole, so the garment always comes
// from the model.

/** Strongly changed (3x3 mean of the largest channel difference). */
const CHANGED = 40;
/** A row counts as garment when this share of it changed (at least 3 px), for 3 rows running. */
const ROW_SHARE = 0.01;
/** Taken from the photo only above this point minus a margin, faded over a band (shares of the height). */
const MARGIN = 0.012;
const FEATHER = 0.012;
/** No point compositing when the garment starts this close to the top (nothing above it to sharpen). */
const MIN_CUT = 0.05;

/** Rows (in the result's pixels) where the try-on changed the photo noticeably, per row. */
export function changedPerRow(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number): number[] {
  const diff = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const k = i * 4;
    diff[i] = Math.max(Math.abs(before[k] - after[k]), Math.abs(before[k + 1] - after[k + 1]), Math.abs(before[k + 2] - after[k + 2]));
  }
  const rows = new Array<number>(height).fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) s += diff[(y + dy) * width + x + dx];
      if (s / 9 > CHANGED) rows[y] += 1;
    }
  }
  return rows;
}

/** The first row of the new garment, as a share of the height, or null when there is nothing worth keeping above it. */
export function garmentTop(rows: number[], width: number): number | null {
  const need = Math.max(3, Math.round(width * ROW_SHARE));
  for (let y = 0; y < rows.length - 2; y += 1) {
    if (rows[y] >= need && rows[y + 1] >= need && rows[y + 2] >= need) {
      const top = y / rows.length;
      return top - MARGIN >= MIN_CUT ? top : null;
    }
  }
  return null;
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
 * The try-on result at the photo's own resolution, with the shopper's photo above the new garment. Falls back to the
 * model's result (as a data URL) when the two can't be lined up or nothing changed.
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
    const top = garmentTop(changedPerRow(small.getImageData(0, 0, W, H).data, out.getImageData(0, 0, W, H).data, W, H), W);
    if (top === null) return fallback;

    const [final, f] = canvas(OW, OH);
    f.imageSmoothingQuality = 'high';
    f.drawImage(output, 0, 0, OW, OH);
    const [head, h] = canvas(OW, OH);
    h.drawImage(original, 0, 0);
    const end = (top - MARGIN) * OH;
    const fade = h.createLinearGradient(0, end - FEATHER * OH, 0, end);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    h.globalCompositeOperation = 'destination-in';
    h.fillStyle = fade;
    h.fillRect(0, 0, OW, OH);
    f.drawImage(head, 0, 0);
    return final.toDataURL('image/jpeg', 0.92);
  } catch (err: unknown) {
    console.warn('[tryon] kept the model result unsharpened', err);
    return fallback;
  } finally {
    original?.close();
    output?.close();
  }
}
