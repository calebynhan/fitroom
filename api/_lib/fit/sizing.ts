// Size recommendation from UNIQLO size charts, and how the chosen size sits on this body. The photo prompt uses
// the result (ease + hem length), so a size up really does look roomier in the shots.
import type { Ease, Length, SizeDelta } from '../look';
import type { SizingBody, SlotPrefs } from './profile';
import type { CatalogItem, SizeSpec } from './catalogItem';

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
export function overCm(item: CatalogItem, spec: SizeSpec, body: SizingBody): number | null {
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

/** How a garment with this much room (garment minus body circumference, cm) reads on the body. */
export function easeOfRoom(slot: CatalogItem['slot'], roomCm: number): Ease {
  return classify(roomCm, slot === 'top' ? TOP_EASE : BOTTOM_EASE);
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

/**
 * Why a size was picked: UNIQLO's chart alone, the shopper's close / relaxed preference, or the size whose garment
 * measurements come closest to a top or pants of their own that fits well.
 */
export type PickReason = 'chart' | 'close' | 'relaxed' | 'reference';

export interface SizePick {
  size: string;
  /** The chart size: the smallest whose body range covers the shopper. */
  chart: string;
  fits: boolean;
  reason: PickReason;
}

/** A size down still counts as wearable for a close fit when the body is at most this far over its range. */
const CLOSE_OVER_CM = 2;
/** Relaxed: size up until the garment reads relaxed, at most this many sizes over the chart size. */
const RELAXED_MAX_STEPS = 2;

/** Garment measurement compared with a reference garment: tops by chest (then length), bottoms by hips (then inseam). */
function referenceScore(item: CatalogItem, spec: SizeSpec, prefs: SlotPrefs): number | null {
  const g = spec.garment;
  if (item.slot === 'top') {
    if (!prefs.chestCm || !g?.chestCm) return null;
    const length = g.lengthCm ?? spec.lengthCm;
    return Math.abs(g.chestCm - prefs.chestCm) + (prefs.lengthCm && length ? 0.5 * Math.abs(length - prefs.lengthCm) : 0);
  }
  if (!prefs.hipsCm || !g?.hipsCm) return null;
  const inseam = g.inseamCm ?? spec.inseamCm;
  return Math.abs(g.hipsCm - prefs.hipsCm) + (prefs.inseamCm && inseam ? 0.3 * Math.abs(inseam - prefs.inseamCm) : 0);
}

/** Beyond every size of the item by more than this (cm, garment circumference), a measured garment is a mismeasure. */
const REFERENCE_SLACK_CM = 10;

/**
 * A reference garment within reach of this item's sizes. A top "35 in flat" (178 cm around) matched a 3XL for a
 * 92 cm chest in testing: measured all the way round instead of laid flat. Out of reach, it's ignored for the pick.
 */
export function referencePlausible(item: CatalogItem, prefs: SlotPrefs): boolean {
  const ref = item.slot === 'top' ? prefs.chestCm : prefs.hipsCm;
  if (!ref) return false;
  const values = chartSizes(item)
    .map((s) => (item.slot === 'top' ? item.sizeChart![s].garment?.chestCm : item.sizeChart![s].garment?.hipsCm))
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return false;
  return ref >= Math.min(...values) - REFERENCE_SLACK_CM && ref <= Math.max(...values) + REFERENCE_SLACK_CM;
}

/** True when the shopper gave a reference garment this item can be compared with. */
export function hasReference(item: CatalogItem, prefs: SlotPrefs | undefined): boolean {
  return Boolean(prefs && (item.slot === 'top' ? prefs.chestCm : prefs.hipsCm));
}

/** The chart size, moved by the shopper's fit preference or matched to a garment of their own. */
export function pickSize(item: CatalogItem, body: SizingBody, prefs?: SlotPrefs): SizePick | null {
  const rec = recommend(item, body);
  if (!rec) return null;
  const chart = rec.size;
  const plain: SizePick = { size: chart, chart, fits: rec.fits, reason: 'chart' };
  if (!rec.fits || !prefs) return plain;
  const sizes = chartSizes(item);
  const i = sizes.indexOf(chart);

  if (hasReference(item, prefs) && referencePlausible(item, prefs)) {
    let best: { size: string; score: number; dist: number } | null = null;
    for (const [j, size] of sizes.entries()) {
      const score = referenceScore(item, item.sizeChart![size], prefs);
      if (score === null) continue;
      const dist = Math.abs(j - i);
      if (!best || score < best.score - 0.01 || (Math.abs(score - best.score) <= 0.01 && dist < best.dist)) best = { size, score, dist };
    }
    if (best) return { ...plain, size: best.size, reason: 'reference' };
  }

  if (prefs.pref === 'relaxed') {
    const last = Math.min(sizes.length - 1, i + RELAXED_MAX_STEPS);
    for (let j = i; j <= last; j += 1) {
      const g = item.sizeChart![sizes[j]].garment;
      const room = item.slot === 'top' ? g?.chestCm && g.chestCm - body.chestCm : g?.hipsCm && g.hipsCm - body.hipsCm;
      if (typeof room !== 'number') return { ...plain, size: sizes[Math.min(i + 1, sizes.length - 1)], reason: 'relaxed' };
      const ease = easeOfRoom(item.slot, room);
      if (ease === 'relaxed' || ease === 'oversized') return { ...plain, size: sizes[j], reason: 'relaxed' };
    }
    return { ...plain, size: sizes[last], reason: 'relaxed' };
  }

  if (prefs.pref === 'close' && i > 0) {
    const down = sizes[i - 1];
    const spec = item.sizeChart![down];
    const over = overCm(item, spec, body);
    const chest = spec.garment?.chestCm;
    const roomOk = item.slot !== 'top' || !chest || chest - body.chestCm >= 0;
    if (over !== null && over <= CLOSE_OVER_CM && roomOk) return { ...plain, size: down, reason: 'close' };
  }
  return { ...plain, reason: prefs.pref === 'regular' ? 'chart' : prefs.pref };
}

export function preferredSize(item: CatalogItem, body: SizingBody, prefs?: SlotPrefs): string | null {
  return pickSize(item, body, prefs)?.size ?? null;
}

/** The estimated measurement a size rests on, and the sizes it could be within one standard deviation. */
export interface Borderline {
  measure: 'chestCm' | 'waistCm';
  /** "chest" / "waist", for the sentence. */
  label: string;
  /** Sizes the pick takes within +-1 SD of the estimate, in UNIQLO's order (includes the pick). */
  sizes: string[];
}

export interface SizeAdvice extends SizePick {
  /** The size worth comparing with the pick: the chart size if they differ, else the next size up (or down). */
  compare: string | null;
  text: string;
  /** Set when the pick rests on an estimate close to a size boundary: measuring would settle it. */
  borderline?: Borderline;
}

/**
 * Residual SD of the ANSUR II estimates (body/profile.ts): a typical estimate is off by this much. The size a top
 * gets turns on the chest, pants on the waist; across 3,400 body x item cases a 1-SD error changed the size for 41%
 * (tops) and 54% (pants), so a size resting on an estimate near a boundary is a guess and is labelled as one.
 */
const ESTIMATE_SD: Record<'chestCm' | 'waistCm', number> = { chestCm: 3.2, waistCm: 4.4 };

/** Sizes within one SD of the deciding estimate, when that spread covers more than one size; else undefined. */
export function borderlineOf(item: CatalogItem, body: SizingBody, prefs: SlotPrefs | undefined, pick: SizePick): Borderline | undefined {
  if (!pick.fits || pick.reason === 'reference') return undefined; // a measured garment decides, not the estimate
  const measure = item.slot === 'top' ? 'chestCm' : 'waistCm';
  if (body.measured?.[measure] !== false) return undefined; // typed in (or unknown): nothing to flag
  const sizes = chartSizes(item);
  const seen = new Set<string>([pick.size]);
  for (const d of [-ESTIMATE_SD[measure], ESTIMATE_SD[measure]]) {
    const other = pickSize(item, { ...body, [measure]: body[measure] + d }, prefs);
    if (other?.fits) seen.add(other.size);
  }
  if (seen.size < 2) return undefined;
  // every size from the smallest to the largest reached (inch sizes skip: 29" at -1 SD, 32" at +1 SD covers 30" too)
  const idx = [...seen].map((s) => sizes.indexOf(s));
  const range = sizes.slice(Math.min(...idx), Math.max(...idx) + 1);
  return { measure, label: measure === 'chestCm' ? 'chest' : 'waist', sizes: range };
}

const sizeLabel = (s: string) => (/inch$/i.test(s) ? `${formatSize(s)} waist` : formatSize(s));

/** "S and M", "29\", 30\" and 31\" waist", and for more than three a range: "28\"–32\" waist" */
export function sizeList(sizes: string[]): string {
  const names = sizes.map(formatSize);
  const joined =
    names.length > 3
      ? `${names[0]}–${names[names.length - 1]}`
      : names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : (names[0] ?? '');
  return sizes.some((s) => /inch$/i.test(s)) ? `${joined} waist` : joined;
}

function adviceText(item: CatalogItem, pick: SizePick, compare: string | null, body: SizingBody): string {
  const { size, chart } = pick;
  const you = `You're ${article(size)} ${sizeLabel(size)}`;
  const byChart = `${sizeLabel(chart)} by UNIQLO's chart.`;
  const theirs = item.slot === 'top' ? 'the top you measured' : 'the pants you measured';
  const sizes = chartSizes(item);
  const roomier = sizes[sizes.indexOf(size) + 1];
  switch (pick.reason) {
    case 'reference':
      return size === chart ? `${you}, the closest to ${theirs}.` : `${sizeLabel(size)} is the closest to ${theirs}; ${byChart}`;
    case 'relaxed': {
      if (size !== chart) return `${sizeLabel(size)} for the relaxed fit you like; ${byChart}`;
      const ease = easeFor(item, size, body);
      if (ease === 'relaxed' || ease === 'oversized') return `${you}; it's already a relaxed fit on you.`;
      return `${you}; there's no roomier size.`;
    }
    case 'close':
      if (size !== chart) return `${sizeLabel(size)} for the close fit you like; ${byChart}`;
      return sizes.indexOf(size) > 0 ? `${you}; a size down would be too small.` : `${you}, the smallest size.`;
    default:
      return `${you}${roomier && compare === roomier ? `; ${formatSize(roomier)} if you want it roomier.` : '.'}`;
  }
}

/** "You're an S; M if you want it roomier." (or a plain warning when no size is made for this body) */
export function sizeAdvice(item: CatalogItem, body: SizingBody, prefs?: SlotPrefs): SizeAdvice | null {
  const pick = pickSize(item, body, prefs);
  if (!pick) return null;
  if (!pick.fits) {
    return { ...pick, compare: null, text: `Runs small for you: even the largest size (${sizeLabel(pick.size)}) is made for a smaller body.` };
  }
  const sizes = chartSizes(item);
  const i = sizes.indexOf(pick.size);
  const borderline = borderlineOf(item, body, prefs, pick);
  if (borderline) {
    // compare with the other likely size, and say it's a guess until they measure
    const other = borderline.sizes.find((s) => s !== pick.size) ?? null;
    const span = borderline.sizes;
    const between =
      span.length > 3 ? `Anywhere from ${sizeList([span[0]])} to ${sizeList([span[span.length - 1]])}` : `Between ${sizeList(span)}`;
    const text = `${between}: your ${borderline.label} is estimated. Likely ${article(pick.size)} ${sizeLabel(pick.size)}; measure your ${borderline.label} to be sure.`;
    return { ...pick, compare: other, text, borderline };
  }
  const compare = pick.size !== pick.chart ? pick.chart : (sizes[i + 1] ?? sizes[i - 1] ?? null);
  return { ...pick, compare, text: adviceText(item, pick, compare, body) };
}

/**
 * The size on screen and the one to compare it with: a size the shopper chose by hand is compared with the pick,
 * the pick with `advice.compare`.
 */
export function sizePair(chosen: string | undefined, advice: SizeAdvice | null): { size: string; compare: string | null } | null {
  const size = chosen ?? advice?.size;
  if (!size) return null;
  if (!advice?.fits) return { size, compare: null };
  return { size, compare: size !== advice.size ? advice.size : advice.compare };
}

/** Garment differences of size `to` against size `from` (cm): what a size comparison photo has to show. */
export function sizeDelta(item: CatalogItem, from: string, to: string): SizeDelta | undefined {
  const a = item.sizeChart?.[from];
  const b = item.sizeChart?.[to];
  if (!a || !b) return undefined;
  const diff = (x: number | undefined, y: number | undefined) => (typeof x === 'number' && typeof y === 'number' ? Math.round((y - x) * 10) / 10 : undefined);
  const out: SizeDelta = {};
  const set = (k: keyof SizeDelta, v: number | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  if (item.slot === 'top') {
    set('chestCm', diff(a.garment?.chestCm, b.garment?.chestCm));
    set('lengthCm', diff(a.garment?.lengthCm ?? a.lengthCm, b.garment?.lengthCm ?? b.lengthCm));
  } else {
    set('hipsCm', diff(a.garment?.hipsCm, b.garment?.hipsCm));
    set('inseamCm', diff(a.garment?.inseamCm ?? a.inseamCm, b.garment?.inseamCm ?? b.inseamCm));
  }
  return Object.keys(out).length ? out : undefined;
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
