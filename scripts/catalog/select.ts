// Pure selection and validation logic for scripts/build-catalog.ts (no I/O, unit-tested).
import type { CatalogItem } from '../../api/_lib/uniqlo.ts';
import type { UniqloListingItem } from '../../api/_lib/uniqloClient.ts';

// Curated-catalog filter (pasted links are judged by mapShape alone). Drops variants that duplicate another item
// (Tall), prints the tint-only viewer cannot show (stripes, checks, colour blocks), innerwear, and cuts our three
// meshes would misrepresent (polos, cardigans, shorts, tights, tanks, vests).
const CURATED_EXCLUDE =
  /\btall\b|strip|pattern|color block|bicolor|\bcheck\b|plaid|herringbone|heattech|\bpolo\b|cardigan|\bshorts\b|\bjorts\b|tights|leggings|tank top|sleeveless|\bvests?\b/i;

const FITS = new Set(['slim', 'regular', 'relaxed']);
const SHAPE_SLOT: Record<string, string> = { tee: 'top', sweater: 'top', pants: 'bottom' };
const HEX = /^#[0-9a-f]{6}$/i;
const PRODUCT_URL = /^https:\/\/www\.uniqlo\.com\/us\/en\/products\/E\d{6}-\d{3}\/00$/;
const IMAGE_URL = /^https:\/\/image\.uniqlo\.com\//;

export interface PickOptions {
  heroes: string[];
  limit: number;
}

/** Product IDs worth fetching details for: heroes first, then the most-reviewed eligible listing items. */
export function pickCandidates(listing: UniqloListingItem[], opts: PickOptions): string[] {
  const heroes = new Set(opts.heroes);
  const seen = new Set<string>();
  const eligible = listing
    .filter((l): l is UniqloListingItem & { productId: string } => typeof l.productId === 'string')
    .filter((l) => {
      if (seen.has(l.productId)) return false;
      seen.add(l.productId);
      return true;
    })
    .filter((l) => heroes.has(l.productId) || (l.sizeGender === 'MEN' && !CURATED_EXCLUDE.test(l.name ?? '')))
    .sort((a, b) => (b.rating?.count ?? 0) - (a.rating?.count ?? 0));

  // Heroes are fetched even when the listing no longer shows them (sold out, moved category).
  const rest = eligible
    .filter((l) => !heroes.has(l.productId))
    .slice(0, opts.limit)
    .map((l) => l.productId);
  return [...opts.heroes, ...rest];
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface GroupOptions {
  heroes: string[];
  target: number;
}

/** Heroes first (all of them), then items in the given order, skipping same-name duplicates, up to `target`. */
export function selectGroup(items: CatalogItem[], opts: GroupOptions): CatalogItem[] {
  const heroRank = (id: string) => opts.heroes.indexOf(id);
  const heroes = items.filter((i) => heroRank(i.id) >= 0).sort((a, b) => heroRank(a.id) - heroRank(b.id));
  const others = items.filter((i) => heroRank(i.id) < 0);

  return [...heroes, ...others].reduce<CatalogItem[]>((picked, candidate) => {
    const isHero = heroRank(candidate.id) >= 0;
    const duplicate = picked.some((p) => nameKey(p.name) === nameKey(candidate.name));
    if (duplicate || (!isHero && picked.length >= opts.target)) return picked;
    return [...picked, candidate];
  }, []);
}

function isPositive(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function sizeChartProblems(item: CatalogItem): string[] {
  if (!item.sizeChart) return [];
  const problems = Object.entries(item.sizeChart).flatMap(([size, spec]) =>
    (['chestCm', 'waistCm', 'hipsCm', 'inseamCm', 'lengthCm'] as const)
      .filter((k) => spec[k] !== undefined && !isPositive(spec[k]))
      .map((k) => `sizeChart ${size}.${k} is not a positive number`),
  );
  const sizes = Array.isArray(item.sizes) ? item.sizes : [];
  const extra = sizes.length > 0 ? Object.keys(item.sizeChart).filter((s) => !sizes.includes(s)) : [];
  return extra.length > 0 ? [...problems, `sizeChart has sizes not in sizes: ${extra.join(', ')}`] : problems;
}

/** Checks an item against the catalog contract in CLAUDE.md. Returns a list of problems (empty = valid). */
export function validateCatalogItem(item: CatalogItem): string[] {
  const checks: [boolean, string][] = [
    [typeof item.name === 'string' && item.name.trim() !== '', 'name is empty'],
    [isPositive(item.price), 'price is not a positive number'],
    [item.salePrice === null || (isPositive(item.salePrice) && item.salePrice < item.price), 'salePrice is not below price'],
    [SHAPE_SLOT[item.shape] !== undefined, 'shape is not tee|sweater|pants'],
    [SHAPE_SLOT[item.shape] === undefined || SHAPE_SLOT[item.shape] === item.slot, 'slot does not match shape'],
    [FITS.has(item.fit), 'fit is not slim|regular|relaxed'],
    [PRODUCT_URL.test(item.url), 'url is not a uniqlo.com product page'],
    [item.image === undefined || IMAGE_URL.test(item.image), 'image is not on image.uniqlo.com'],
    [Array.isArray(item.colors) && item.colors.length > 0, 'colors is empty'],
  ];
  const colorProblems = (item.colors ?? []).flatMap((c) => [
    ...(HEX.test(c.hex) ? [] : [`colour ${c.code} hex is not #rrggbb`]),
    ...(IMAGE_URL.test(c.swatch) ? [] : [`colour ${c.code} swatch is not on image.uniqlo.com`]),
  ]);
  const sizesOk = Array.isArray(item.sizes) && item.sizes.length > 0;
  return [
    ...checks.filter(([ok]) => !ok).map(([, msg]) => msg),
    ...colorProblems,
    ...(sizesOk ? [] : ['sizes is empty']),
    ...sizeChartProblems(item),
  ];
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
