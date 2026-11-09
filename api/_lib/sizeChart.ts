// Pure parser for UNIQLO's size-charts API:
//   GET /us/api/commerce/v5/en/products/size-charts?productIdsWithColorCode=<id,id>&includeBodyMeasurements=true
// Each product has `sizeChart` (garment, "finished size") and `bodyMeasurements` (the body each size is made for).
// No I/O and no relative imports: Node runs scripts/ straight from .ts, so shared _lib modules stay leaf modules.

export type RangeCm = [min: number, max: number];

export interface BodyRanges {
  chestCm?: RangeCm;
  waistCm?: RangeCm;
  hipsCm?: RangeCm;
}

/** Garment ("finished") measurements. Circumferences are full circumferences, not flat widths. */
export interface GarmentMeasurements {
  chestCm?: number;
  waistCm?: number;
  hipsCm?: number;
  lengthCm?: number;
  shoulderCm?: number;
  sleeveCm?: number;
  inseamCm?: number;
  riseCm?: number;
  thighCm?: number;
  hemCm?: number;
}

/**
 * One size. Top-level chest/waist/hips are BODY measurements: the upper end of the range UNIQLO says the size
 * fits. Top-level inseam/length are GARMENT measurements (inseam for pants, body length for tops).
 */
export interface SizeSpec {
  chestCm?: number;
  waistCm?: number;
  hipsCm?: number;
  inseamCm?: number;
  lengthCm?: number;
  body?: BodyRanges;
  garment?: GarmentMeasurements;
}

export type SizeChart = Record<string, SizeSpec>;

export interface UniqloMeasurement {
  value?: string;
  unit?: string;
}

export interface UniqloSizePart {
  code?: string;
  name?: string;
  info?: string;
  measurements?: UniqloMeasurement[];
}

export interface UniqloSizeRow {
  name?: string;
  sizeCode?: string;
  sizeParts?: (UniqloSizePart | null)[];
}

export interface UniqloSizeChartEntry {
  productId?: string;
  sizeChart?: UniqloSizeRow[] | null;
  bodyMeasurements?: UniqloSizeRow[] | null;
}

export interface ParsedSizeChart {
  chart: SizeChart | null;
  unknownParts: string[];
}

const INCH_CM = 2.54;
const FRACTIONS: Record<string, string> = { '¼': '.25', '½': '.5', '¾': '.75', '⅛': '.125', '⅜': '.375', '⅝': '.625', '⅞': '.875' };

interface GarmentRule {
  key: keyof GarmentMeasurements;
  /** UNIQLO lists some widths flat (one layer); double them to get a circumference. */
  flat: boolean;
}

// Exact codes first; prefixes catch variants like "knit-body-length-front" / "body-length-back".
const GARMENT_CODES: Record<string, GarmentRule> = {
  'body-width': { key: 'chestCm', flat: true },
  'shoulder-width': { key: 'shoulderCm', flat: false },
  'waist-product-size': { key: 'waistCm', flat: false },
  'hip-product-size': { key: 'hipsCm', flat: false },
  thigh: { key: 'thighCm', flat: true },
  'rising-length': { key: 'riseCm', flat: false },
  'bottom-width': { key: 'hemCm', flat: true },
  inseam: { key: 'inseamCm', flat: false },
  // Centre-back only: tee mesh vs sweater mesh is decided on this number (< 65 cm = short sleeve).
  'sleeve-length-cb': { key: 'sleeveCm', flat: false },
};
const GARMENT_PATTERNS: [RegExp, GarmentRule][] = [[/body-length/, { key: 'lengthCm', flat: false }]];

const BODY_CODES: Record<string, keyof BodyRanges> = {
  'nude-chest': 'chestCm',
  'nude-bust': 'chestCm',
  'nude-waist': 'waistCm',
  'nude-hip': 'hipsCm',
  'nude-hips': 'hipsCm',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNumber(text: string): number | null {
  const normalized = text
    .replace(/\s*([¼½¾⅛⅜⅝⅞])/g, (_, f: string) => FRACTIONS[f])
    .trim()
    .replace(/^\./, '0.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return n > 0 ? n : null;
}

/**
 * Parses one measurement cell. "58.5" -> [58.5, 58.5]; "104 - 112" -> [104, 112]; "78 / 85" (several lengths)
 * -> [78, 78]. Prefers cm; falls back to inches. Returns null for "-", blanks and anything unparseable.
 */
export function parseMeasurement(measurements: UniqloMeasurement[] | undefined): RangeCm | null {
  if (!Array.isArray(measurements)) return null;
  const cm = measurements.find((m) => m?.unit === 'cm' && m.value?.trim());
  const inch = measurements.find((m) => m?.unit === 'inch' && m.value?.trim());
  const picked = cm ?? inch;
  if (!picked?.value) return null;
  const scale = picked === cm ? 1 : INCH_CM;

  const first = picked.value.split('/')[0];
  const ends = first.split(/\s*[-–~]\s*/).map(parseNumber);
  if (ends.length === 0 || ends.length > 2 || ends.some((n) => n === null)) return null;
  const [lo, hi = lo] = ends as number[];
  return [round2(lo * scale), round2(hi * scale)];
}

function garmentRule(code: string): GarmentRule | null {
  return GARMENT_CODES[code] ?? GARMENT_PATTERNS.find(([re]) => re.test(code))?.[1] ?? null;
}

function validParts(row: UniqloSizeRow): UniqloSizePart[] {
  return (row.sizeParts ?? []).filter((p): p is UniqloSizePart => Boolean(p && typeof p.code === 'string'));
}

function parseGarmentRow(row: UniqloSizeRow, unknown: Set<string>): GarmentMeasurements {
  return validParts(row).reduce<GarmentMeasurements>((acc, part) => {
    const rule = garmentRule(part.code as string);
    if (!rule) {
      unknown.add(part.code as string);
      return acc;
    }
    const value = parseMeasurement(part.measurements);
    if (!value || acc[rule.key] !== undefined) return acc;
    return { ...acc, [rule.key]: round2(rule.flat ? value[0] * 2 : value[0]) };
  }, {});
}

function parseBodyRow(row: UniqloSizeRow, unknown: Set<string>): BodyRanges {
  return validParts(row).reduce<BodyRanges>((acc, part) => {
    const key = BODY_CODES[part.code as string];
    if (!key) {
      unknown.add(part.code as string);
      return acc;
    }
    const value = parseMeasurement(part.measurements);
    return value && acc[key] === undefined ? { ...acc, [key]: value } : acc;
  }, {});
}

function rowsByName<T>(rows: UniqloSizeRow[] | null | undefined, parse: (row: UniqloSizeRow) => T): Map<string, T> {
  const named = (rows ?? []).filter((r) => typeof r?.name === 'string' && r.name.trim() !== '');
  return new Map(named.map((r) => [(r.name as string).trim(), parse(r)]));
}

function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

function buildSpec(body: BodyRanges, garment: GarmentMeasurements): SizeSpec {
  return {
    ...(body.chestCm && { chestCm: body.chestCm[1] }),
    ...(body.waistCm && { waistCm: body.waistCm[1] }),
    ...(body.hipsCm && { hipsCm: body.hipsCm[1] }),
    ...(garment.inseamCm !== undefined && { inseamCm: garment.inseamCm }),
    ...(garment.lengthCm !== undefined && { lengthCm: garment.lengthCm }),
    ...(!isEmpty(body) && { body }),
    ...(!isEmpty(garment) && { garment }),
  };
}

/** Converts one product's size-charts entry into the catalog `sizeChart` map (null when nothing is usable). */
export function parseSizeChart(entry: UniqloSizeChartEntry | undefined | null): ParsedSizeChart {
  const unknown = new Set<string>();
  if (!entry) return { chart: null, unknownParts: [] };

  const garments = rowsByName(entry.sizeChart, (r) => parseGarmentRow(r, unknown));
  const bodies = rowsByName(entry.bodyMeasurements, (r) => parseBodyRow(r, unknown));
  const names = [...new Set([...garments.keys(), ...bodies.keys()])];

  const specs = names
    .map((name) => [name, buildSpec(bodies.get(name) ?? {}, garments.get(name) ?? {})] as const)
    .filter(([, spec]) => !isEmpty(spec));

  return {
    chart: specs.length > 0 ? Object.fromEntries(specs) : null,
    unknownParts: [...unknown].sort(),
  };
}
