// Pure UNIQLO helpers shared by /api/product, scripts/build-catalog.ts and the web paste-JSON fallback.
// No I/O here: callers fetch, this module parses and maps. Only type imports (erased at runtime), so Node can
// run scripts/ straight from .ts.
import type { SizeChart } from './sizeChart';

export type { SizeChart, SizeSpec } from './sizeChart';
export type Slot = 'top' | 'bottom';
export type Shape = 'tee' | 'sweater' | 'pants';
export type Fit = 'slim' | 'regular' | 'relaxed';

export interface CatalogColor {
  code: string;
  name: string;
  hex: string;
  swatch: string;
  /** Product photo in this colour, when UNIQLO lists one. */
  image?: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  slot: Slot;
  shape: Shape;
  fabric: string;
  fit: Fit;
  url: string;
  image?: string;
  colors: CatalogColor[];
  /** Arrays from the ingest script and /api/product; a "XXS-3XL" string only in legacy catalog files. */
  sizes: string[] | string;
  sizeChart: SizeChart | null;
}

// Digit boundaries so "1234567-000" is not read as E234567-000.
const PRODUCT_ID_RE = /(?<!\d)E?(\d{6})-(\d{3})(?!\d)/i;

/** Accepts a product URL, a bare ID ("E453754-000") or a 6-digit number. Returns "E453754-000" or null. */
export function parseProductId(input: string): string | null {
  const text = input.trim();
  const full = text.match(PRODUCT_ID_RE);
  if (full) return `E${full[1]}-${full[2]}`;
  const bare = text.match(/^\d{6}$/);
  return bare ? `E${bare[0]}-000` : null;
}

export function productNumber(id: string): string {
  return id.replace(/^E/i, '').replace(/-\d{3}$/, '');
}

export function productPageUrl(id: string): string {
  return `https://www.uniqlo.com/us/en/products/${id}/00`;
}

export function swatchUrl(id: string, colorCode: string): string {
  const num = productNumber(id);
  return `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/${num}/chip/goods_${colorCode}_${num}_chip.jpg`;
}

export interface ShapeMapping {
  shape: Shape;
  slot: Slot;
  fabric: string;
}

// Garments our three meshes would misrepresent: shorts, skirts and tights render as full pants; vests and tanks as
// sleeved tops; dresses as tees; jackets, hoodies and full-zips as closed knits. "\bshorts\b" is plural on purpose
// ("Short Sleeve" and petite "| Short" lengths are fine), and "Dress Pants" / "Dress Shirts" are not dresses.
const UNSUPPORTED = new RegExp(
  [
    '\\bshorts\\b', '\\bjorts\\b', '\\bskirts?\\b', '\\bskorts?\\b', '\\bdress(es)?\\b(?! (pants|shirts?|trousers))',
    '\\btights\\b', '\\bleggings\\b', '\\btank top\\b', '\\bsleeveless\\b', '\\bboxers?\\b', '\\bbriefs?\\b', '\\btrunks\\b', '\\bsocks?\\b',
    '\\bjackets?\\b', '\\bcoats?\\b', '\\bparkas?\\b', '\\bblazers?\\b',
  ].join('|'),
  'i',
);
// Judged on the product name only: "Sweatshirts & Hoodies" is one category, and crew sweatshirts are fine.
// Cardigans are open-front; the sweater mesh is closed.
const UNSUPPORTED_NAME = /\bvests?\b|\bhood(ed|ie|ies)?\b|\bfull[- ]zip\b|\bcardigans?\b/i;
// No bare "denim": a "Denim Shirt" is a shirt. Button-up shirts match neither PANTS nor TOP, so they are unsupported.
const PANTS = /\bpants?\b|\btrousers?\b|\bchinos?\b|\bjeans?\b|\bjoggers?\b|\bsweatpants?\b|\bslacks?\b|\bbottoms?\b/i;
// Word boundaries matter: "Sweatshirts" contains "tshirt".
const TOP = /\bt-?shirts?\b|\btees?\b|\bsweaters?\b|\bknit|\bsweatshirts?\b|\bpullovers?\b|\bturtlenecks?\b|\bhenleys?\b/i;
const LONG_SLEEVE_NAME = /long[- ]sleeve/i;
const SHORT_SLEEVE_NAME = /short[- ]sleeve|half[- ]sleeve|\bt-?shirts?\b|\btees?\b/i;
const LONG_BY_DEFAULT = /\bsweaters?\b|\bknit|\bsweatshirts?\b|\bpullovers?\b|\bturtlenecks?\b/i;
const SHORT_SLEEVE_TAGS = new Set(['short', 'half', 'half-sleeve', 'french']);
const NO_SLEEVE_TAGS = new Set(['sleeveless', 'no-sleeve', 'none']);

function slotOf(categoryText: string, name: string): Slot | null {
  // Category first; collection and technology lines ("Uniqlo U", "AIRism") have no garment category, so the name decides.
  for (const text of [categoryText, name]) {
    if (PANTS.test(text)) return 'bottom';
    if (TOP.test(text)) return 'top';
  }
  return null;
}

/** Sleeve tag ("short" | "long" | ...) first, then the name, then "knits are long-sleeved, tees are not". */
function isLongSleeve(categoryText: string, name: string, sleeve?: string): boolean {
  if (sleeve === 'long') return true;
  if (sleeve && SHORT_SLEEVE_TAGS.has(sleeve)) return false;
  if (LONG_SLEEVE_NAME.test(name)) return true;
  if (SHORT_SLEEVE_NAME.test(name)) return false;
  return LONG_BY_DEFAULT.test(`${name} ${categoryText}`);
}

function fabricOf(slot: Slot, text: string): string {
  if (slot === 'bottom') {
    if (/corduroy/i.test(text)) return 'twill';
    if (/jean|denim/i.test(text)) return 'denim';
    return /sweat|jogger|jersey|fleece/i.test(text) ? 'jersey' : 'twill';
  }
  if (/cashmere/i.test(text)) return 'cashmere';
  return /sweater|knit|merino|milano/i.test(text) ? 'rib_knit' : 'jersey';
}

/**
 * Maps breadcrumb/category/name text to a garment shape, slot and fabric; null when our meshes cannot show it.
 * `sleeve` is UNIQLO's sleeve tag, or "short" | "long" read off the size chart: long sleeves use the sweater mesh.
 */
export function mapShape(categoryText: string, name = '', sleeve?: string): ShapeMapping | null {
  if (UNSUPPORTED.test(`${categoryText} ${name}`) || UNSUPPORTED_NAME.test(name)) return null;
  if (sleeve && NO_SLEEVE_TAGS.has(sleeve)) return null;
  const slot = slotOf(categoryText, name);
  if (!slot) return null;
  const fabric = fabricOf(slot, `${name} ${categoryText}`);
  if (slot === 'bottom') return { shape: 'pants', slot, fabric };
  return { shape: isLongSleeve(categoryText, name, sleeve) ? 'sweater' : 'tee', slot, fabric };
}

export interface UniqloTag {
  group?: string;
  tag?: string;
  tagName?: string;
}

const SLIM = /\b(slim|skinny|fitted|tight)\b/i;
const RELAXED = /\b(relaxed|loose|baggy|oversized|wide|boxy|barrel|balloon)\b/i;

function fitFromText(text: string): Fit | null {
  if (SLIM.test(text)) return 'slim';
  if (RELAXED.test(text)) return 'relaxed';
  return null;
}

/** UNIQLO's top-fit / bottom-fit tag -> slim | regular | relaxed. A clear name ("Slim", "Wide") beats "regular". */
export function mapFit(tags: UniqloTag[] | undefined, name: string): Fit {
  const fitTag = arrayOf(tags).find((t) => t?.group === 'top-fit' || t?.group === 'bottom-fit');
  const tagText = `${fitTag?.tag ?? ''} ${fitTag?.tagName ?? ''}`;
  const fromTag = fitFromText(tagText);
  if (fromTag) return fromTag;
  return fitFromText(name) ?? 'regular';
}

// Fallback hex by UNIQLO colour code family when a swatch cannot be sampled.
// Codes are 2 digits: tens = hue family, units = roughly light -> dark.
const FAMILY_RAMPS: Record<string, [string, string]> = {
  '0': ['#f2f2f0', '#2b2b2b'], // white / gray / black
  '1': ['#f6c6c8', '#6e2130'], // pink / red / wine
  '2': ['#f7c08a', '#a8471c'], // orange
  '3': ['#e9dcc4', '#4a3226'], // natural / beige / brown
  '4': ['#f5e7a6', '#a3801f'], // yellow / mustard
  '5': ['#c9dcb6', '#2f3d25'], // green / olive
  '6': ['#bcd3ea', '#1d2a44'], // blue / navy
  '7': ['#d9c9e6', '#4a2d5c'], // purple
};

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mixed = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function fallbackHex(code: string): string {
  const digits = code.replace(/\D/g, '').padStart(2, '0').slice(-2);
  const ramp = FAMILY_RAMPS[digits[0]] ?? FAMILY_RAMPS['0'];
  return lerpHex(ramp[0], ramp[1], Number(digits[1]) / 9);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Raw shape of the parts of the UNIQLO details response we rely on. */
export interface UniqloDetails {
  productId?: string;
  name?: string;
  prices?: { base?: { value?: number } | null; promo?: { value?: number } | null };
  breadcrumbs?: Record<string, { locale?: string; name?: string } | undefined>;
  colors?: { displayCode?: string; name?: string }[];
  sizes?: { name?: string }[];
  images?: { main?: Record<string, { image?: string } | undefined> };
  representative?: { color?: { displayCode?: string } };
  tags?: UniqloTag[];
  rating?: { average?: number; count?: number };
  sizeGender?: string;
  sizeChartUrl?: string;
}

export type ToItemResult = { item: CatalogItem } | { error: string };

function categoryTextOf(raw: UniqloDetails): string {
  const crumbs = raw.breadcrumbs ?? {};
  return ['class', 'category', 'subcategory'].map((k) => `${crumbs[k]?.locale ?? ''} ${crumbs[k]?.name ?? ''}`).join(' ');
}

/** UNIQLO JSON can also arrive pasted by a user: only image.uniqlo.com URLs and plain colour codes get through. */
const IMAGE_HOST = /^https:\/\/image\.uniqlo\.com\//;
const COLOR_CODE = /^[A-Za-z0-9]{1,8}$/;

function arrayOf<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function safeImage(url: unknown): string | undefined {
  return typeof url === 'string' && IMAGE_HOST.test(url) ? url : undefined;
}

/** Restricts a size chart to the sizes the item sells, in the item's order; null if none overlap. */
export function alignSizeChart(chart: SizeChart | null, sizes: string[]): SizeChart | null {
  if (!chart) return null;
  const rows = sizes.filter((s) => chart[s]).map((s) => [s, chart[s]] as const);
  return rows.length > 0 ? Object.fromEntries(rows) : null;
}

function mainImage(raw: UniqloDetails, codes: string[]): string | undefined {
  const main = raw.images?.main ?? {};
  const preferred = [raw.representative?.color?.displayCode, ...codes].filter((c): c is string => Boolean(c));
  const hit = preferred.map((c) => safeImage(main[c]?.image)).find(Boolean);
  return hit ?? Object.values(main).map((m) => safeImage(m?.image)).find(Boolean);
}

const SHORT_SLEEVE_MAX_CM = 65; // centre-back sleeve length: tees ~46-57 cm, long sleeves ~85-95 cm

/** "short" | "long" from the garment sleeve length of the middle size, when the size chart has one. */
export function sleeveFromChart(chart: SizeChart | null): 'short' | 'long' | undefined {
  const lengths = Object.values(chart ?? {})
    .map((spec) => spec.garment?.sleeveCm)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  if (lengths.length === 0) return undefined;
  return lengths[Math.floor(lengths.length / 2)] < SHORT_SLEEVE_MAX_CM ? 'short' : 'long';
}

/** Pants sizes go by waist and hips: UNIQLO's body chest on some pants charts would mislead a size recommender. */
function chartForSlot(chart: SizeChart | null, slot: Slot): SizeChart | null {
  if (!chart || slot === 'top') return chart;
  const rows = Object.entries(chart).map(([size, spec]) => {
    const { chestCm: _chest, body, ...rest } = spec;
    const { chestCm: _bodyChest, ...bodyRest } = body ?? {};
    return [size, { ...rest, ...(Object.keys(bodyRest).length > 0 && { body: bodyRest }) }] as const;
  });
  return Object.fromEntries(rows);
}

/**
 * Shape, slot and fabric for a details response, or null if we cannot show it honestly. The size chart's garment
 * sleeve length, when present, beats the sleeve tag (many knits have no tags at all).
 */
export function shapeOf(raw: UniqloDetails, chart: SizeChart | null = null): ShapeMapping | null {
  const name = raw.name?.replace(/[®™]/g, '').trim() ?? '';
  const sleeve = sleeveFromChart(chart) ?? arrayOf(raw.tags).find((t) => t?.group === 'sleeve')?.tag;
  return mapShape(categoryTextOf(raw), name, sleeve);
}

/**
 * Converts a UNIQLO details `result` object into a CatalogItem.
 * `hexFor` lets the server substitute colours sampled from swatch images; `sizeChart` comes from parseSizeChart.
 */
export function toCatalogItem(
  id: string,
  raw: UniqloDetails,
  hexFor: (code: string) => string = fallbackHex,
  sizeChart: SizeChart | null = null,
): ToItemResult {
  const name = raw.name?.replace(/[®™]/g, '').trim();
  const base = raw.prices?.base?.value;
  if (!name || typeof base !== 'number') return { error: 'That product page did not include a name and price.' };

  const mapped = shapeOf(raw, sizeChart);
  if (!mapped) {
    const crumbs = raw.breadcrumbs ?? {};
    const label = crumbs.category?.locale ?? crumbs.class?.locale ?? 'this category';
    return { error: `${name} (${label}) is not supported yet. Try a T-shirt, sweater or pants.` };
  }

  const main = raw.images?.main ?? {};
  const colors = arrayOf(raw.colors)
    .filter((c): c is { displayCode: string; name?: string } => typeof c?.displayCode === 'string' && COLOR_CODE.test(c.displayCode))
    .map((c) => {
      const image = safeImage(main[c.displayCode]?.image);
      return {
        code: c.displayCode,
        name: titleCase(typeof c.name === 'string' ? c.name : c.displayCode),
        hex: hexFor(c.displayCode),
        swatch: swatchUrl(id, c.displayCode),
        ...(image && { image }),
      };
    });
  if (colors.length === 0) return { error: `${name} has no colourways listed.` };

  const promo = raw.prices?.promo?.value;
  const sizes = arrayOf(raw.sizes)
    .map((s) => (typeof s?.name === 'string' ? s.name.trim() : ''))
    .filter(Boolean);

  return {
    item: {
      id,
      name,
      price: base,
      salePrice: typeof promo === 'number' && promo < base ? promo : null,
      ...mapped,
      fit: mapFit(raw.tags, name),
      url: productPageUrl(id),
      image: mainImage(raw, colors.map((c) => c.code)),
      colors,
      sizes,
      sizeChart: chartForSlot(alignSizeChart(sizeChart, sizes), mapped.slot),
    },
  };
}
