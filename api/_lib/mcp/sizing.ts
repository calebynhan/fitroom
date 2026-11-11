// Size advice for the ChatGPT plugin: the web app's own sizing code (web/src/fit), so a size asked in ChatGPT is the
// size the website gives for the same body. Measurements come in the shopper's units (in/lb or cm/kg).
import {
  EMPTY_PROFILE,
  FIT_PREFS,
  LIMITS,
  OPTIONAL,
  displayRange,
  fitPrefs,
  fromDisplay,
  sizingBody,
  unitLabel,
  type FitPref,
  type MeasureKey,
  type Profile,
  type SizingBody,
  type Units,
} from '../fit/profile';
import { fitCard, type FitCard } from '../fit/fitCard';
import { chartSizes, easeFor, fitSummary, formatSize, lengthFor, shortSize, sizeAdvice, sizePair } from '../fit/sizing';
import type { CatalogItem } from '../uniqlo';

export interface BodyInput {
  units?: unknown;
  height?: unknown;
  weight?: unknown;
  chest?: unknown;
  waist?: unknown;
  hips?: unknown;
  inseam?: unknown;
  fit?: unknown;
  ownGarment?: unknown;
}

export type BodyResult =
  | { ok: true; body: SizingBody; profile: Profile; units: Units }
  | { ok: false; message: string };

const FIELDS: [keyof BodyInput, MeasureKey][] = [
  ['height', 'heightCm'],
  ['weight', 'weightKg'],
  ['chest', 'chestCm'],
  ['waist', 'waistCm'],
  ['hips', 'hipsCm'],
  ['inseam', 'inseamCm'],
];
const GARMENT_FIELDS: [string, MeasureKey][] = [
  ['chestFlat', 'refTopChestFlatCm'],
  ['length', 'refTopLengthCm'],
  ['hipsFlat', 'refBottomHipsFlatCm'],
  ['inseam', 'refBottomInseamCm'],
];
const NAMES: Partial<Record<MeasureKey, string>> = {
  heightCm: 'Height',
  weightKg: 'Weight',
  chestCm: 'Chest',
  waistCm: 'Waist',
  hipsCm: 'Hips',
  inseamCm: 'Inseam',
  refTopChestFlatCm: 'Your top laid flat, armpit to armpit,',
  refTopLengthCm: 'Your top length',
  refBottomHipsFlatCm: 'Your pants laid flat across the hips',
  refBottomInseamCm: 'Your pants inseam',
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rangeHint(key: MeasureKey, units: Units): string {
  const [min, max] = displayRange(key, units);
  return `${min}–${max} ${unitLabel(key, units)}`;
}

/** Validated body (estimates fill the blanks) and fit preferences, or the first problem in shopper words. */
export function parseBody(input: BodyInput, slot: CatalogItem['slot']): BodyResult {
  const units: Units = input.units === 'metric' ? 'metric' : 'imperial';
  const profile: Profile = { ...EMPTY_PROFILE, units };
  const set = (key: MeasureKey, raw: unknown, required: boolean): string | null => {
    const shown = num(raw);
    if (shown === null) {
      if (raw !== undefined && raw !== null) return `${NAMES[key]} must be a number in ${unitLabel(key, units)}.`;
      return required ? `${NAMES[key]} is needed (${unitLabel(key, units)}).` : null;
    }
    const metric = fromDisplay(key, shown, units);
    const [min, max] = LIMITS[key];
    if (metric < min || metric > max) return `${NAMES[key]} ${shown} ${unitLabel(key, units)} is outside ${rangeHint(key, units)}.`;
    (profile as unknown as Record<MeasureKey, number>)[key] = metric;
    return null;
  };
  for (const [field, key] of FIELDS) {
    const problem = set(key, input[field], key === 'heightCm' || key === 'weightKg');
    if (problem) return { ok: false, message: problem };
  }
  if (input.ownGarment && typeof input.ownGarment === 'object') {
    const garment = input.ownGarment as Record<string, unknown>;
    for (const [field, key] of GARMENT_FIELDS) {
      const problem = set(key, garment[field], false);
      if (problem) return { ok: false, message: problem };
    }
  }
  const pref: FitPref = (FIT_PREFS as readonly unknown[]).includes(input.fit) ? (input.fit as FitPref) : 'regular';
  if (slot === 'top') profile.fitTop = pref;
  else profile.fitBottom = pref;
  const body = sizingBody(profile);
  if (!body) return { ok: false, message: `Height and weight are needed (${rangeHint('heightCm', units)}, ${rangeHint('weightKg', units)}).` };
  return { ok: true, body, profile, units };
}

/** "m", "M", "30", '30"', "30 inch" -> the item's own size name ("M", "30inch"), or null. */
export function matchSize(item: CatalogItem, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const want = raw.trim().toLowerCase().replace(/["”\s]|inch(es)?$/g, '');
  return chartSizes(item).find((s) => s.toLowerCase() === raw.trim().toLowerCase() || shortSize(s).toLowerCase() === want) ?? null;
}

export interface SizeResult {
  /** The size to buy (the pick, or the size asked about). */
  size: string | null;
  sizeLabel: string | null;
  /** What the sizing logic recommends, and why. */
  pick: { size: string; chart: string; fits: boolean; reason: string } | null;
  text: string;
  compare: string | null;
  borderline: { measure: string; sizes: string[] } | null;
  /** "Regular fit, hip length on you" for `size`. */
  summary: string | null;
  card: FitCard | null;
  /** Measurements this item's size rests on that were estimated from height + weight, e.g. ["waist", "hips"]. */
  estimated: string[];
  units: Units;
}

/** The size advice and fit card for this item on this body; `asked` = a size the shopper is considering. */
export function adviseSize(item: CatalogItem, parsed: Extract<BodyResult, { ok: true }>, asked?: string | null): SizeResult {
  const { body, profile, units } = parsed;
  const prefs = fitPrefs(profile)[item.slot];
  const advice = sizeAdvice(item, body, prefs);
  // the estimates this item's size and fit rest on: tops chest, bottoms waist, hips and inseam
  const relevant = item.slot === 'top' ? ['chestCm'] : ['waistCm', 'hipsCm', 'inseamCm'];
  const estimated = OPTIONAL.filter((k) => relevant.includes(k) && body.measured?.[k] === false).map((k) => k.replace('Cm', ''));
  if (!advice) {
    return {
      size: null,
      sizeLabel: null,
      pick: null,
      text: `UNIQLO publishes no size chart FitRoom can read for ${item.name}, so there is no size to recommend. Check the size guide on the product page.`,
      compare: null,
      borderline: null,
      summary: null,
      card: null,
      estimated,
      units,
    };
  }
  const pair = sizePair(asked ?? undefined, advice);
  const size = pair?.size ?? advice.size;
  const sizes = [size, pair?.compare].filter((s): s is string => typeof s === 'string');
  let text = advice.text;
  if (asked && asked !== advice.size) {
    text = advice.fits ? `${advice.text} You asked about ${formatSize(asked)}: the fit card compares it with ${formatSize(advice.size)}.` : advice.text;
  }
  return {
    size,
    sizeLabel: formatSize(size),
    pick: { size: advice.size, chart: advice.chart, fits: advice.fits, reason: advice.reason },
    text,
    compare: pair?.compare ?? null,
    borderline: advice.borderline ? { measure: advice.borderline.label, sizes: advice.borderline.sizes.map(formatSize) } : null,
    summary: fitSummary(easeFor(item, size, body), lengthFor(item, size, body)),
    card: fitCard(item, sizes, body, units, prefs),
    estimated,
    units,
  };
}

/** The fit card as plain lines for the model: "Chest room: 14 cm (regular) | 20 cm (relaxed)". */
export function cardLines(card: FitCard): string[] {
  const head = `Fit card (${card.sizes.join(' vs ')}):`;
  const rows = card.rows.map((r) => `- ${r.label}: ${r.cells.map((c) => (c.sub ? `${c.main} (${c.sub})` : c.main)).join(' | ')}`);
  return [head, ...rows, ...card.notes.map((n) => `Note: ${n}`)];
}
