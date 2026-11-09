// Size recommendation from UNIQLO size charts, and how the chosen size sits on this body. The photo prompt uses
// the result (ease + hem length), so a size up really does look roomier in the shots.
import type { BodySpec, Ease, Length } from '@api/look';
import type { CatalogItem, SizeSpec } from '../catalog/types';

/** Sizes in UNIQLO's order that have a size-chart row. */
export function chartSizes(item: CatalogItem): string[] {
  if (!Array.isArray(item.sizes)) return [];
  return item.sizeChart ? item.sizes.filter((s) => item.sizeChart?.[s]) : [];
}

/** Body measurements this size is made for, compared with the shopper's: null when the chart has none to compare. */
function covers(item: CatalogItem, spec: SizeSpec, body: BodySpec): boolean | null {
  const pairs: [number | undefined, number][] =
    item.slot === 'top'
      ? [
          [spec.chestCm, body.chestCm],
          [spec.waistCm, body.waistCm],
        ]
      : [
          [spec.waistCm, body.waistCm],
          [spec.hipsCm, body.hipsCm],
        ];
  const known = pairs.filter((p): p is [number, number] => typeof p[0] === 'number');
  if (known.length === 0) return null;
  return known.every(([max, mine]) => max >= mine);
}

/** The smallest size whose body measurements cover the shopper's (the largest if none does). */
export function recommendSize(item: CatalogItem, body: BodySpec): string | null {
  const sizes = chartSizes(item);
  let lastComparable: string | null = null;
  for (const size of sizes) {
    const fits = covers(item, item.sizeChart![size], body);
    if (fits === null) continue;
    if (fits) return size;
    lastComparable = size;
  }
  return lastComparable;
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

export function easeFor(item: CatalogItem, size: string, body: BodySpec): Ease | undefined {
  const g = item.sizeChart?.[size]?.garment;
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

export function lengthFor(item: CatalogItem, size: string, body: BodySpec): Length | undefined {
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
  text: string;
}

/** "You're an S; M if you want it roomier." */
export function sizeAdvice(item: CatalogItem, body: BodySpec): SizeAdvice | null {
  const size = recommendSize(item, body);
  if (!size) return null;
  const sizes = chartSizes(item);
  const roomier = sizes[sizes.indexOf(size) + 1] ?? null;
  const label = (s: string) => (/inch$/i.test(s) ? `${formatSize(s)} waist` : formatSize(s));
  const text = `You're ${article(size)} ${label(size)}${roomier ? `; ${formatSize(roomier)} if you want it roomier.` : '.'}`;
  return { size, roomier, text };
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
