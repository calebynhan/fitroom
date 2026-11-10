// The fit card: how each of two sizes sits on this body, in numbers from UNIQLO's size chart. Numbers can't drift
// the way generated pixels can, so the card keeps the size comparison honest even when a photo blurs it.
import { CM_PER_IN, type SizingBody, type SlotPrefs, type Units } from '../body/profile';
import type { CatalogItem, SizeSpec } from '../catalog/types';
import { easeFor, formatSize } from './sizing';

export interface FitCell {
  main: string;
  sub?: string;
}

export interface FitRow {
  label: string;
  cells: FitCell[];
}

export interface FitCard {
  sizes: string[];
  rows: FitRow[];
  notes: string[];
}

// Same rules as lengthFor: a top's hem sits at the hip at about 39% of height; pants are full length when the
// garment inseam is about 4 cm under the body's inseam.
const TOP_LENGTH_PER_HEIGHT = 0.39;
const PANTS_INSEAM_ALLOWANCE_CM = 4;
/** Closer than this to the hip counts as "at the hip" (the 39% rule is rough). */
const AT_HIP_CM = 2;

/** 14 -> "14 cm" | "5.5 in" */
export function formatLength(cm: number, units: Units): string {
  if (units === 'imperial') {
    const inches = Math.round((cm / CM_PER_IN) * 2) / 2;
    return `${Object.is(inches, -0) ? 0 : inches} in`;
  }
  const rounded = Math.round(cm * 2) / 2;
  return `${Object.is(rounded, -0) ? 0 : rounded} cm`;
}

/** +2 -> "+2 cm", -1 -> "−1 cm", 0 -> "same" */
export function formatDiff(cm: number, units: Units): string {
  const text = formatLength(Math.abs(cm), units);
  if (text.startsWith('0 ')) return 'same';
  return `${cm > 0 ? '+' : '−'}${text}`;
}

function rangeText([min, max]: [number, number], units: Units): string {
  if (min === max) return formatLength(min, units);
  const [a, b] = [formatLength(min, units), formatLength(max, units)];
  return `${a.split(' ')[0]}–${b}`;
}

function roomCell(item: CatalogItem, size: string, room: number, body: SizingBody, units: Units): FitCell {
  const ease = easeFor(item, size, body);
  if (room < -0.5) return { main: `${formatLength(-room, units)} tight`, sub: 'close' };
  return { main: formatLength(Math.max(0, room), units), sub: ease };
}

function topLength(spec: SizeSpec, body: SizingBody, units: Units): FitCell | null {
  const length = spec.garment?.lengthCm ?? spec.lengthCm;
  if (!length) return null;
  const d = length - TOP_LENGTH_PER_HEIGHT * body.heightCm;
  const sub = Math.abs(d) <= AT_HIP_CM ? 'at the hip' : `${formatLength(Math.abs(d), units)} ${d > 0 ? 'below' : 'above'} hip`;
  return { main: formatLength(length, units), sub };
}

function pantsLength(spec: SizeSpec, body: SizingBody, units: Units): FitCell | null {
  const inseam = spec.garment?.inseamCm ?? spec.inseamCm;
  if (!inseam) return null;
  const d = inseam - (body.inseamCm - PANTS_INSEAM_ALLOWANCE_CM);
  const sub = d <= -10 ? 'cropped' : d <= -4 ? 'ankle length' : d <= 5 ? 'full length' : 'stacks on the shoe';
  return { main: formatLength(inseam, units), sub };
}

function waistCell(spec: SizeSpec, body: SizingBody, units: Units): FitCell | null {
  const range = spec.body?.waistCm ?? (spec.waistCm ? ([spec.waistCm, spec.waistCm] as [number, number]) : undefined);
  if (!range) return null;
  const [min, max] = range;
  const tolerance = min === max ? 1.5 : 0; // single-number ranges (inch sizes) name one waist
  const sub =
    body.waistCm > max + tolerance
      ? `snug by ${formatLength(body.waistCm - max, units)}`
      : body.waistCm < min - tolerance
        ? `loose by ${formatLength(min - body.waistCm, units)}`
        : 'fits your waist';
  return { main: rangeText(range, units), sub };
}

function plain(v: number | undefined, units: Units): FitCell | null {
  return typeof v === 'number' ? { main: formatLength(v, units) } : null;
}

/** "+2 cm chest" / "−1 cm length" against the shopper's own garment. */
function versusCell(parts: [string, number | undefined, number | undefined][], units: Units): FitCell | null {
  const known = parts.filter((p): p is [string, number, number] => typeof p[1] === 'number' && typeof p[2] === 'number');
  if (known.length === 0) return null;
  const [first, second] = known.map(([label, theirs, mine]) => `${formatDiff(theirs - mine, units)} ${label}`);
  return second ? { main: first, sub: second } : { main: first };
}

function row(label: string, cells: (FitCell | null)[]): FitRow | null {
  if (cells.every((c) => c === null)) return null;
  return { label, cells: cells.map((c) => c ?? { main: '—' }) };
}

/** Rows comparing `sizes` (usually the chosen size and one other) on this body; null without a size chart. */
export function fitCard(item: CatalogItem, sizes: string[], body: SizingBody, units: Units, prefs?: SlotPrefs): FitCard | null {
  const specs = sizes.map((s) => item.sizeChart?.[s]).filter((s): s is SizeSpec => Boolean(s));
  if (specs.length === 0 || specs.length !== sizes.length) return null;
  const rows: (FitRow | null)[] = [];
  const notes: string[] = [];

  if (item.slot === 'top') {
    rows.push(
      row(
        'Chest room',
        specs.map((spec, i) =>
          spec.garment?.chestCm
            ? roomCell(item, sizes[i], spec.garment.chestCm - body.chestCm, body, units)
            : spec.body?.chestCm
              ? { main: rangeText(spec.body.chestCm, units), sub: 'body chest' }
              : null,
        ),
      ),
      row('Length', specs.map((spec) => topLength(spec, body, units))),
      row('Shoulders', specs.map((spec) => plain(spec.garment?.shoulderCm, units))),
      row('Sleeve', specs.map((spec) => plain(spec.garment?.sleeveCm, units))),
    );
    if (prefs?.chestCm) {
      rows.push(
        row(
          'vs your top',
          specs.map((spec) =>
            versusCell(
              [
                ['chest', spec.garment?.chestCm, prefs.chestCm],
                ['length', spec.garment?.lengthCm ?? spec.lengthCm, prefs.lengthCm],
              ],
              units,
            ),
          ),
        ),
      );
    }
    if (body.measured?.chestCm === false) notes.push('Room is against your estimated chest (±3 cm); measure it for exact numbers.');
  } else {
    rows.push(
      row('Waist', specs.map((spec) => waistCell(spec, body, units))),
      row(
        'Hip room',
        specs.map((spec, i) => (spec.garment?.hipsCm ? roomCell(item, sizes[i], spec.garment.hipsCm - body.hipsCm, body, units) : null)),
      ),
      row('Inseam', specs.map((spec) => pantsLength(spec, body, units))),
      row('Thigh', specs.map((spec) => plain(spec.garment?.thighCm, units))),
    );
    if (prefs?.hipsCm) {
      rows.push(
        row(
          'vs your pants',
          specs.map((spec) =>
            versusCell(
              [
                ['hips', spec.garment?.hipsCm, prefs.hipsCm],
                ['inseam', spec.garment?.inseamCm ?? spec.inseamCm, prefs.inseamCm],
              ],
              units,
            ),
          ),
        ),
      );
    }
    const estimated = (['waistCm', 'hipsCm', 'inseamCm'] as const).filter((k) => body.measured?.[k] === false);
    if (estimated.length) {
      const names = estimated.map((k) => k.replace('Cm', '')).join(', ').replace(/, ([^,]*)$/, ' and $1');
      notes.push(`Your ${names} ${estimated.length > 1 ? 'are' : 'is'} estimated from height and weight; measure for exact numbers.`);
    }
  }
  notes.unshift('Room = garment measurement minus yours, all the way around.');
  return { sizes: sizes.map(formatSize), rows: rows.filter((r): r is FitRow => r !== null), notes };
}
