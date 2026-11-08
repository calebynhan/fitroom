// Pure UNIQLO helpers shared by /api/product and the web paste-JSON fallback.
// No I/O here: callers fetch, this module parses and maps.

export type Slot = 'top' | 'bottom';
export type Shape = 'tee' | 'sweater' | 'pants';

export interface CatalogColor {
  code: string;
  name: string;
  hex: string;
  swatch: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  slot: Slot;
  shape: Shape;
  fabric: string;
  url: string;
  image?: string;
  colors: CatalogColor[];
  sizes: string[] | string;
}

const PRODUCT_ID_RE = /E?(\d{6})-(\d{3})/i;

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

export function detailsApiUrl(id: string): string {
  return `https://www.uniqlo.com/us/api/commerce/v5/en/products/${id}/price-groups/00/details?includeModelSize=false&httpFailure=true`;
}

export function productPageUrl(id: string): string {
  return `https://www.uniqlo.com/us/en/products/${id}/00`;
}

export function swatchUrl(id: string, colorCode: string): string {
  const num = productNumber(id);
  return `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/${num}/chip/goods_${colorCode}_${num}_chip.jpg`;
}

interface ShapeRule {
  pattern: RegExp;
  shape: Shape;
  slot: Slot;
  fabric: string;
}

// Order matters: more specific patterns first.
const SHAPE_RULES: ShapeRule[] = [
  { pattern: /jean|denim/i, shape: 'pants', slot: 'bottom', fabric: 'denim' },
  { pattern: /pant|trouser|chino|bottom|jogger|slack/i, shape: 'pants', slot: 'bottom', fabric: 'twill' },
  { pattern: /cashmere/i, shape: 'sweater', slot: 'top', fabric: 'cashmere' },
  { pattern: /sweater|knit|cardigan/i, shape: 'sweater', slot: 'top', fabric: 'rib_knit' },
  { pattern: /t-?shirt|tee/i, shape: 'tee', slot: 'top', fabric: 'jersey' },
];

/** Maps breadcrumb/category/name text to a garment shape. Returns null for unsupported categories. */
export function mapShape(categoryText: string, name = ''): Omit<ShapeRule, 'pattern'> | null {
  // Category decides the shape; the name can refine fabric (e.g. "Cashmere Sweater").
  const byCategory = SHAPE_RULES.find((r) => r.pattern.test(categoryText));
  if (!byCategory) return null;
  const byName = SHAPE_RULES.find((r) => r.shape === byCategory.shape && r.pattern.test(name));
  const rule = byName ?? byCategory;
  return { shape: rule.shape, slot: rule.slot, fabric: rule.fabric };
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
  images?: { main?: Record<string, { image?: string }> };
}

export type ToItemResult = { item: CatalogItem } | { error: string };

/**
 * Converts a UNIQLO details `result` object into a CatalogItem.
 * `hexFor` lets the server substitute colours sampled from swatch images.
 */
export function toCatalogItem(
  id: string,
  raw: UniqloDetails,
  hexFor: (code: string) => string = fallbackHex,
): ToItemResult {
  const name = raw.name?.replace(/[®™]/g, '').trim();
  const base = raw.prices?.base?.value;
  if (!name || typeof base !== 'number') return { error: 'That product page did not include a name and price.' };

  const crumbs = raw.breadcrumbs ?? {};
  const categoryText = ['class', 'category', 'subcategory']
    .map((k) => `${crumbs[k]?.locale ?? ''} ${crumbs[k]?.name ?? ''}`)
    .join(' ');
  const mapped = mapShape(categoryText, name);
  if (!mapped) {
    const label = crumbs.category?.locale ?? crumbs.class?.locale ?? 'this category';
    return { error: `${name} (${label}) is not supported yet. Try a T-shirt, sweater or pants.` };
  }

  const colors = (raw.colors ?? [])
    .filter((c): c is { displayCode: string; name?: string } => Boolean(c.displayCode))
    .map((c) => ({
      code: c.displayCode,
      name: titleCase(c.name ?? c.displayCode),
      hex: hexFor(c.displayCode),
      swatch: swatchUrl(id, c.displayCode),
    }));
  if (colors.length === 0) return { error: `${name} has no colourways listed.` };

  const promo = raw.prices?.promo?.value;
  const firstMain = raw.images?.main ? Object.values(raw.images.main)[0]?.image : undefined;

  return {
    item: {
      id,
      name,
      price: base,
      salePrice: typeof promo === 'number' && promo < base ? promo : null,
      ...mapped,
      url: productPageUrl(id),
      image: firstMain,
      colors,
      sizes: (raw.sizes ?? []).map((s) => s.name ?? '').filter(Boolean),
    },
  };
}
