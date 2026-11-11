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
import { fitCard, formatLength, type FitCard } from '../fit/fitCard';
import { chartSizes, easeFor, easeOfRoom, fitSummary, formatSize, lengthFor, recommend, shortSize, sizeAdvice, sizePair } from '../fit/sizing';
import type { Ease } from '../look';
import type { CatalogItem, SizeSpec } from '../uniqlo';

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
  /** The size to buy: what the sizing logic recommends (ChatGPT test 2026-11-11: never the size asked about). */
  size: string | null;
  sizeLabel: string | null;
  /** A different size the shopper asked about ("will an M fit?"), compared on the card; null otherwise. */
  asked: string | null;
  askedLabel: string | null;
  /** What the sizing logic recommends, and why. */
  pick: { size: string; chart: string; fits: boolean; reason: string } | null;
  text: string;
  compare: string | null;
  borderline: { measure: string; sizes: string[] } | null;
  /** "Regular fit, hip length on you" for `size`, and for `asked`. */
  summary: string | null;
  askedSummary: string | null;
  card: FitCard | null;
  /** The raw sizes on the card, recommended first. */
  cardSizes: string[];
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
      asked: null,
      askedLabel: null,
      pick: null,
      text: `UNIQLO publishes no size chart FitRoom can read for ${item.name}, so there is no size to recommend. Check the size guide on the product page.`,
      compare: null,
      borderline: null,
      summary: null,
      askedSummary: null,
      card: null,
      cardSizes: [],
      estimated,
      units,
    };
  }
  const other = asked && asked !== advice.size ? asked : null;
  // recommended first, then the size they asked about, or the one worth comparing
  const cardSizes = [advice.size, other ?? sizePair(undefined, advice)?.compare].filter((s): s is string => typeof s === 'string');
  const text =
    other && advice.fits ? `${advice.text} You asked about ${formatSize(other)}: the fit card compares it with ${formatSize(advice.size)}.` : advice.text;
  return {
    size: advice.size,
    sizeLabel: formatSize(advice.size),
    asked: other,
    askedLabel: other ? formatSize(other) : null,
    pick: { size: advice.size, chart: advice.chart, fits: advice.fits, reason: advice.reason },
    text,
    compare: cardSizes[1] ?? null,
    borderline: advice.borderline ? { measure: advice.borderline.label, sizes: advice.borderline.sizes.map(formatSize) } : null,
    summary: fitSummary(easeFor(item, advice.size, body), lengthFor(item, advice.size, body)),
    askedSummary: other ? fitSummary(easeFor(item, other, body), lengthFor(item, other, body)) : null,
    card: fitCard(item, cardSizes, body, units, prefs),
    cardSizes,
    estimated,
    units,
  };
}

// ---- Size charts: how an item (or UNIQLO's men's tops / pants in general) is sized, without the shopper's body ----

export interface ChartRow {
  size: string;
  label: string;
  cells: string[];
}

export interface SizeChartResult {
  /** Column headings, the first being who the size is made for ("Chest (body)"). */
  columns: string[];
  rows: ChartRow[];
  /** The cut read off the chart: room between the garment and the largest body each size is made for. */
  cut: { ease: Ease; roomText: string } | null;
  /** The size a given chest / waist falls in, by UNIQLO's chart. */
  match: { size: string; label: string; fits: boolean; text: string } | null;
  units: Units;
}

const range = (r: [number, number] | undefined, max: number | undefined, units: Units): string | null => {
  if (r) return r[0] === r[1] ? formatLength(r[0], units) : `${formatLength(r[0], units).split(' ')[0]}–${formatLength(r[1], units)}`;
  return typeof max === 'number' ? `up to ${formatLength(max, units)}` : null;
};
const len = (v: number | undefined, units: Units) => (typeof v === 'number' ? formatLength(v, units) : null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** UNIQLO's chart for one item: body range per size (who it's made for) and the garment's own measurements. */
export function sizeChartFor(
  item: CatalogItem,
  units: Units,
  measure: { chestCm?: number; waistCm?: number; hipsCm?: number } = {},
): SizeChartResult | null {
  const sizes = chartSizes(item);
  if (sizes.length === 0) return null;
  const top = item.slot === 'top';
  const columns = top ? ['Chest (body)', 'Chest (garment)', 'Length', 'Sleeve', 'Shoulders'] : ['Waist (body)', 'Hips (garment)', 'Inseam', 'Thigh', 'Rise'];
  const rows = sizes.map((size) => {
    const spec = item.sizeChart![size];
    const g = spec.garment ?? {};
    const cells = top
      ? [range(spec.body?.chestCm, spec.chestCm, units), len(g.chestCm, units), len(g.lengthCm ?? spec.lengthCm, units), len(g.sleeveCm, units), len(g.shoulderCm, units)]
      : [range(spec.body?.waistCm, spec.waistCm, units), len(g.hipsCm, units), len(g.inseamCm ?? spec.inseamCm, units), len(g.thighCm, units), len(g.riseCm, units)];
    return { size, label: formatSize(size), cells: cells.map((c) => c ?? '—') };
  });
  // drop columns UNIQLO gives nothing for
  const keep = columns.map((_, i) => rows.some((r) => r.cells[i] !== '—'));
  const result: SizeChartResult = {
    columns: columns.filter((_, i) => keep[i]),
    rows: rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })),
    cut: null,
    match: null,
    units,
  };
  // the cut: garment chest (tops) / hips (pants) minus the largest body each size is made for, median over sizes
  const rooms = sizes
    .map((s) => {
      const spec = item.sizeChart![s];
      return top
        ? spec.garment?.chestCm && spec.chestCm ? spec.garment.chestCm - spec.chestCm : null
        : spec.garment?.hipsCm && spec.hipsCm ? spec.garment.hipsCm - spec.hipsCm : null;
    })
    .filter((v): v is number => typeof v === 'number');
  const room = median(rooms);
  if (room !== null) {
    const ease = easeOfRoom(item.slot, room);
    result.cut = {
      ease,
      roomText:
        room >= 0
          ? `each size measures about ${formatLength(room, units)} more around the ${top ? 'chest' : 'hips'} than the largest body it's made for`
          : `each size measures about ${formatLength(-room, units)} less around the ${top ? 'chest' : 'hips'} than the largest body it's made for (a stretch fit)`,
    };
  }
  const deciding = top ? measure.chestCm : measure.waistCm;
  if (typeof deciding === 'number') {
    const body = {
      heightCm: 0,
      weightKg: 0,
      chestCm: measure.chestCm ?? 0,
      waistCm: measure.waistCm ?? 0,
      hipsCm: measure.hipsCm ?? 0,
      inseamCm: 0,
      measured: { chestCm: measure.chestCm !== undefined, waistCm: measure.waistCm !== undefined, hipsCm: measure.hipsCm !== undefined, inseamCm: false },
    } as SizingBody;
    const rec = recommend(item, body);
    if (rec) {
      const what = top ? `A ${formatLength(measure.chestCm!, units)} chest` : `A ${formatLength(measure.waistCm!, units)} waist`;
      result.match = {
        size: rec.size,
        label: formatSize(rec.size),
        fits: rec.fits,
        text: rec.fits
          ? `${what} is ${/^[AEFHILMNORSX8]/i.test(rec.size) ? 'an' : 'a'} ${formatSize(rec.size)} by UNIQLO's chart.`
          : `${what} is over even the largest size (${formatSize(rec.size)}) by UNIQLO's chart.`,
      };
    }
  }
  return result;
}

/**
 * UNIQLO's men's tops or pants in general, from every catalog item of that slot: for each size, the body range most
 * items give (UNIQLO's charts barely vary within a category). For "what does a men's medium measure at UNIQLO?".
 */
export function generalChartItem(items: CatalogItem[], slot: CatalogItem['slot'], letterSizes: boolean): CatalogItem | null {
  const votes = new Map<string, Map<string, { spec: SizeSpec; n: number }>>();
  for (const item of items) {
    if (item.slot !== slot) continue;
    for (const size of chartSizes(item)) {
      if (/inch$/i.test(size) === letterSizes) continue;
      const spec = item.sizeChart![size];
      const key = JSON.stringify(slot === 'top' ? [spec.body?.chestCm, spec.chestCm] : [spec.body?.waistCm, spec.waistCm]);
      const bySize = votes.get(size) ?? new Map();
      const hit = bySize.get(key) ?? { spec: { chestCm: spec.chestCm, waistCm: spec.waistCm, hipsCm: spec.hipsCm, body: spec.body }, n: 0 };
      hit.n += 1;
      bySize.set(key, hit);
      votes.set(size, bySize);
    }
  }
  if (votes.size === 0) return null;
  const order = (s: string) => {
    const inch = s.match(/^(\d+)\s*inch$/i);
    if (inch) return Number(inch[1]);
    const letters = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
    return letters.indexOf(s.toUpperCase());
  };
  const sizes = [...votes.keys()].sort((a, b) => order(a) - order(b));
  const sizeChart: Record<string, SizeSpec> = {};
  for (const size of sizes) {
    const best = [...votes.get(size)!.values()].sort((a, b) => b.n - a.n)[0];
    sizeChart[size] = best.spec;
  }
  return {
    id: `general-${slot}`,
    name: slot === 'top' ? "UNIQLO men's tops" : letterSizes ? "UNIQLO men's pants (S–XXL)" : "UNIQLO men's jeans and chinos (inch sizes)",
    price: 0,
    salePrice: null,
    slot,
    shape: slot === 'top' ? 'tee' : 'pants',
    fabric: '',
    fit: 'regular',
    url: 'https://www.uniqlo.com/us/en/',
    colors: [],
    sizes,
    sizeChart,
  };
}

/** The size chart as plain lines for the model. */
export function chartLines(chart: SizeChartResult): string[] {
  return chart.rows.map((r) => `- ${r.label}: ${chart.columns.map((c, i) => `${c} ${r.cells[i]}`).filter((t) => !t.endsWith('—')).join(', ')}`);
}

/** The fit card as plain lines for the model: "Chest room: 14 cm (regular) | 20 cm (relaxed)". */
export function cardLines(card: FitCard): string[] {
  const head = `Fit card (${card.sizes.join(' vs ')}):`;
  const rows = card.rows.map((r) => `- ${r.label}: ${r.cells.map((c) => (c.sub ? `${c.main} (${c.sub})` : c.main)).join(' | ')}`);
  return [head, ...rows, ...card.notes.map((n) => `Note: ${n}`)];
}
