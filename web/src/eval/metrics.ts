// Try-on quality metrics, computed on pixels (RGBA arrays, same size). Proxies, not ground truth, but they caught
// every problem seen by eye in the 2026-11-10 test: a face that changed, a garment that didn't change (dark pants over
// dark jeans), an invented background (blurry selfie) and colour drift from the product.

export interface TryOnScores {
  /** Share of the photo the try-on changed noticeably (0..1). Very low: garment not applied. Very high: redrawn scene. */
  changed: number;
  /** Mean absolute RGB difference (0..255) above the new garment (face, hair, background): ~0-3 = untouched. */
  aboveGarment: number | null;
  /** Colour difference (CIE76 dE in Lab) between the new garment and the product's fabric; < 3 invisible, > 10 obvious. */
  colourDE: number | null;
  /** Lightness difference (result - product): negative = darker than on UNIQLO's site. */
  lightnessD: number | null;
}

const CHANGED = 40;

export function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Median Lab colour of the pixels selected by `pick` (null when none). */
export function medianLab(px: Uint8ClampedArray, width: number, height: number, pick: (x: number, y: number) => boolean): [number, number, number] | null {
  const L: number[] = [];
  const A: number[] = [];
  const B: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!pick(x, y)) continue;
      const k = (y * width + x) * 4;
      const [l, a, b] = lab(px[k], px[k + 1], px[k + 2]);
      L.push(l);
      A.push(a);
      B.push(b);
    }
  }
  return L.length ? [median(L), median(A), median(B)] : null;
}

/**
 * Scores a try-on: `before` is the shopper's photo and `after` the result, both drawn at the same size; `product` is the
 * garment photo with `fabric`, a box (fractions x0, y0, x1, y1) on plain fabric.
 */
export function scoreTryOn(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
  product: { px: Uint8ClampedArray; width: number; height: number; fabric: [number, number, number, number] },
): TryOnScores {
  const changed = new Uint8Array(width * height);
  let n = 0;
  for (let i = 0; i < width * height; i += 1) {
    const k = i * 4;
    if (Math.max(Math.abs(before[k] - after[k]), Math.abs(before[k + 1] - after[k + 1]), Math.abs(before[k + 2] - after[k + 2])) > CHANGED) {
      changed[i] = 1;
      n += 1;
    }
  }
  // the new garment's top edge: first of 3 rows with >= 1% (min 3 px) changed
  const need = Math.max(3, Math.round(width * 0.01));
  const rowCount = (y: number) => {
    let c = 0;
    for (let x = 0; x < width; x += 1) c += changed[y * width + x];
    return c;
  };
  let top = -1;
  for (let y = 0; y < height - 2 && top < 0; y += 1) if (rowCount(y) >= need && rowCount(y + 1) >= need && rowCount(y + 2) >= need) top = y;

  let above: number | null = null;
  if (top > 4) {
    let s = 0;
    let m = 0;
    for (let y = 0; y < top - 4; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const k = (y * width + x) * 4;
        s += (Math.abs(before[k] - after[k]) + Math.abs(before[k + 1] - after[k + 1]) + Math.abs(before[k + 2] - after[k + 2])) / 3;
        m += 1;
      }
    }
    above = m ? s / m : null;
  }

  const garment = top >= 0 && n >= width * height * 0.01 ? medianLab(after, width, height, (x, y) => y >= top && changed[y * width + x] === 1) : null;
  const [x0, y0, x1, y1] = product.fabric;
  const fabric = medianLab(product.px, product.width, product.height, (x, y) => x >= x0 * product.width && x < x1 * product.width && y >= y0 * product.height && y < y1 * product.height);
  const colourDE = garment && fabric ? Math.hypot(garment[0] - fabric[0], garment[1] - fabric[1], garment[2] - fabric[2]) : null;
  return { changed: n / (width * height), aboveGarment: above, colourDE, lightnessD: garment && fabric ? garment[0] - fabric[0] : null };
}

/** Plain-language flags for a score, using the thresholds seen in testing. */
export function flags(s: TryOnScores): string[] {
  const out: string[] = [];
  if (s.changed < 0.01) out.push('garment barely changed (similar colour to what they wore?)');
  if (s.changed > 0.3) out.push('large area redrawn (blur, background or pose changed)');
  if (s.aboveGarment !== null && s.aboveGarment > 6) out.push('face or background changed');
  if (s.colourDE !== null && s.colourDE > 12) out.push('colour far from the product');
  return out;
}
