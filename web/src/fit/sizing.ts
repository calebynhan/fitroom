// Size recommendation from UNIQLO size charts, and how the chosen size sits on this body. The photo prompt uses
// the result (ease + hem length), so a size up really does look roomier in the shots.
import type { Ease, Length } from '@api/look';
import type { SizingBody } from '../body/profile';
import type { CatalogItem, SizeSpec } from '../catalog/types';

/** Sizes in UNIQLO's order that have a size-chart row. */
export function chartSizes(item: CatalogItem): string[] {
  if (!Array.isArray(item.sizes)) return [];
  return item.sizeChart ? item.sizes.filter((s) => item.sizeChart?.[s]) : [];
}

/**
 * How far the shopper is above what this size is made for (cm; <= 0 means it fits), or null when the chart has no
 * body measurement to compare. Tops go by chest, plus waist only when the shopper typed one in (an estimated waist,
 * SD 4.4 cm, should not push a size up); bottoms go by waist, plus hips only when typed in.
 */
function overCm(item: CatalogItem, spec: SizeSpec, body: SizingBody): number | null {
  const typed = (k: 'waistCm' | 'hipsCm') => body.measured?.[k] !== false;
  const pairs: [number | undefined, number][] =
    item.slot === 'top'
      ? [[spec.chestCm, body.chestCm], ...(typed('waistCm') ? [[spec.waistCm, body.waistCm] as [number | undefined, number]] : [])]
      : [[spec.waistCm, body.waistCm], ...(typed('hipsCm') ? [[spec.hipsCm, body.hipsCm] as [number | undefined, number]] : [])];
  const known = pairs.filter((p): p is [number, number] => typeof p[0] === 'number');
  if (known.length === 0) return null;
  return Math.max(...known.map(([max, mine]) => mine - max));
}

export interface Recommendation {
  size: string;
  /** False when even the largest size is made for a smaller body. */
  fits: boolean;
}

/** The smallest size whose body measurements cover the shopper's (the largest, marked as not fitting, if none does). */
export function recommend(item: CatalogItem, body: SizingBody): Recommendation | null {
  let largest: string | null = null;
  for (const size of chartSizes(item)) {
    const over = overCm(item, item.sizeChart![size], body);
    if (over === null) continue;
    if (over <= 0) return { size, fits: true };
    largest = size;
  }
  return largest ? { size: largest, fits: false } : null;
}

export function recommendSize(item: CatalogItem, body: SizingBody): string | null {
  return recommend(item, body)?.size ?? null;
}

// Ease = garment circumference minus body circumference (tops: chest, bottoms: hips), in cm.
const TOP_EASE: [number, Ease][] = [
  [8, 'close'],
  [16, 'regular'],
  [25, 'relaxed'],
];
const BOTTOM_EASE: [number, Ease][] = [
  [6, 'close'],
  [14, 'regular'],
  [24, 'relaxed'],
];

function classify(diff: number, table: [number, Ease][]): Ease {
  return table.find(([limit]) => diff < limit)?.[1] ?? 'oversized';
}

const BY_STEP: Ease[] = ['close', 'regular', 'relaxed', 'oversized'];

/** Over the size's body range by more than this, the garment reads as tight whatever its cut. */
const TIGHT_OVER_CM = 4;

export function easeFor(item: CatalogItem, size: string, body: SizingBody): Ease | undefined {
  const spec = item.sizeChart?.[size];
  const over = spec ? overCm(item, spec, body) : null;
  if (over !== null && over > TIGHT_OVER_CM) return 'close';
  const g = spec?.garment;
  if (item.slot === 'top' && g?.chestCm) return classify(g.chestCm - body.chestCm, TOP_EASE);
  if (item.slot === 'bottom' && g?.hipsCm) return classify(g.hipsCm - body.hipsCm, BOTTOM_EASE);
  // No garment measurements: judge by steps from the recommended size.
  const sizes = chartSizes(item);
  const rec = recommendSize(item, body);
  if (!rec || !sizes.includes(size)) return undefined;
  const step = sizes.indexOf(size) - sizes.indexOf(rec);
  return BY_STEP[Math.min(3, Math.max(0, step + 1))];
}

// A top's body length (high shoulder point to hem) sits at the hip at about 39% of height; pants are full length
// when the garment inseam is about 4 cm under the body's crotch height (ANSUR inseam). Rough, but it separates a
// cropped tee from a long one and ankle pants from full-length ones.
const TOP_LENGTH_PER_HEIGHT = 0.39;
const PANTS_INSEAM_ALLOWANCE_CM = 4;

export function lengthFor(item: CatalogItem, size: string, body: SizingBody): Length | undefined {
  const spec = item.sizeChart?.[size];
  if (!spec) return undefined;
  if (item.slot === 'top') {
    const length = spec.garment?.lengthCm ?? spec.lengthCm;
    if (!length) return undefined;
    const d = length - TOP_LENGTH_PER_HEIGHT * body.heightCm;
    return d < -5 ? 'cropped' : d > 5 ? 'long' : 'regular';
  }
  const inseam = spec.garment?.inseamCm ?? spec.inseamCm;
  if (!inseam) return undefined;
  const d = inseam - (body.inseamCm - PANTS_INSEAM_ALLOWANCE_CM);
  if (d <= -10) return 'cropped';
  if (d <= -4) return 'ankle';
  return d <= 5 ? 'full' : 'long';
}

/** "30inch" -> 30" ; "M" -> M */
export function formatSize(size: string): string {
  const inch = size.match(/^(\d+(?:\.\d+)?)\s*inch$/i);
  return inch ? `${inch[1]}"` : size;
}

/** Chip label: "30inch" -> 30 */
export function shortSize(size: string): string {
  return size.replace(/\s*inch$/i, '');
}

function article(size: string): string {
  return /^[AEFHILMNORSX8]/i.test(size) ? 'an' : 'a';
}

export interface SizeAdvice {
  size: string;
  roomier: string | null;
  fits: boolean;
  text: string;
}

/** "You're an S; M if you want it roomier." (or a plain warning when no size is made for this body) */
export function sizeAdvice(item: CatalogItem, body: SizingBody): SizeAdvice | null {
  const rec = recommend(item, body);
  if (!rec) return null;
  const label = (s: string) => (/inch$/i.test(s) ? `${formatSize(s)} waist` : formatSize(s));
  if (!rec.fits) {
    return { size: rec.size, roomier: null, fits: false, text: `Runs small for you: even the largest size (${label(rec.size)}) is made for a smaller body.` };
  }
  const sizes = chartSizes(item);
  const roomier = sizes[sizes.indexOf(rec.size) + 1] ?? null;
  const text = `You're ${article(rec.size)} ${label(rec.size)}${roomier ? `; ${formatSize(roomier)} if you want it roomier.` : '.'}`;
  return { size: rec.size, roomier, fits: true, text };
}

const EASE_WORDS: Record<Ease, string> = { close: 'Close fit', regular: 'Regular fit', relaxed: 'Relaxed fit', oversized: 'Oversized' };
const LENGTH_WORDS: Record<Length, string> = {
  cropped: 'cropped',
  regular: 'hip length',
  long: 'long',
  ankle: 'ankle length',
  full: 'full length',
};

/** "Regular fit, hip length on you" */
export function fitSummary(ease: Ease | undefined, length: Length | undefined): string | null {
  if (!ease && !length) return null;
  const parts = [ease ? EASE_WORDS[ease] : null, length ? LENGTH_WORDS[length] : null].filter(Boolean);
  const text = `${parts.join(', ')} on you`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
