// The catalog for the ChatGPT plugin: web/public/catalog.json (read from disk once per warm instance; vercel.json
// ships it with the function), plus any UNIQLO US product by link or ID through the same lookup as /api/product.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colorLabel, findColor, parseCatalog, productImage } from '../fit/catalogItem';
import { getProduct } from '../productLookup';
import { parseProductId, type CatalogColor, type CatalogItem } from '../uniqlo';

let items: CatalogItem[] | null = null;

/** Repo root on Vercel and in vitest; web/ under `vite dev`. */
const CATALOG_PATHS = ['web/public/catalog.json', 'public/catalog.json'];

export function catalogItems(): CatalogItem[] {
  if (items) return items;
  for (const rel of CATALOG_PATHS) {
    try {
      items = parseCatalog(JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')));
      return items;
    } catch {
      // try the next location
    }
  }
  console.error('[mcp] catalog.json not found from', process.cwd());
  items = [];
  return items;
}

/** For tests. */
export function setCatalogForTest(list: CatalogItem[] | null): void {
  items = list;
}

const STOP = new Set(['the', 'a', 'an', 'uniqlo', 'mens', 'men', 'for', 'in', 'and', 'with', 'of']);
const SYNONYMS: Record<string, string> = { tshirt: 'tee', trouser: 'pant', jumper: 'sweater', pullover: 'sweater' };

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/\bt[\s-]?shirts?\b/g, 'tee')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(?<!s)s$/, '')) // pants -> pant, sweaters -> sweater, jeans -> jean (not "cross" -> "cros")
    .map((w) => SYNONYMS[w] ?? w);
}

export type Resolved = { ok: true; item: CatalogItem } | { ok: false; message: string };

/**
 * A product from a UNIQLO link, an ID ("E453754-000"), a 6-digit number, or a name close to one in the catalog
 * ("milano ribbed sweater"). Links and IDs outside the catalog are loaded from UNIQLO.
 */
export async function resolveProduct(query: string): Promise<Resolved> {
  const text = query.trim().slice(0, 500);
  if (!text) return { ok: false, message: 'Name a UNIQLO product, or paste its link.' };
  const id = parseProductId(text);
  if (id) {
    const known = catalogItems().find((i) => i.id === id);
    if (known) return { ok: true, item: known };
    const res = await getProduct(id);
    if (res.ok) return { ok: true, item: res.item };
    if (res.body.code === 'blocked') return { ok: false, message: `UNIQLO didn't answer for ${id}. Try again in a minute.` };
    return { ok: false, message: res.body.error };
  }
  const wanted = words(text);
  if (wanted.length === 0) return { ok: false, message: 'Name a UNIQLO product, or paste its link.' };
  const key = (list: string[]) => [...new Set(list)].sort().join(' ');
  const exact = catalogItems().find((item) => key(words(item.name)) === key(wanted));
  if (exact) return { ok: true, item: exact };
  const scored = catalogItems()
    .map((item) => {
      const have = new Set(words(item.name));
      const hits = wanted.filter((w) => have.has(w)).length;
      // share of the query found in the name, less a little for each word of the name the query didn't mention
      return { item, score: hits / wanted.length - 0.04 * Math.max(0, have.size - hits) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score >= 0.6 && (!scored[1] || best.score - scored[1].score >= 0.05)) return { ok: true, item: best.item };
  const close = scored.slice(0, 3).map((s) => `${s.item.name} (${s.item.id})`);
  return {
    ok: false,
    message: close.length
      ? `Which one: ${close.join(', ')}? Pass its ID or link.`
      : `"${text}" isn't in FitRoom's catalog. Paste the UNIQLO US product link instead, or search with find_clothes.`,
  };
}

/** The colour by UNIQLO code ("09") or name ("black", "navy"); the item's first colour when nothing matches. */
export function resolveColor(item: CatalogItem, query: string | undefined): { color: CatalogColor; matched: boolean } {
  const q = (query ?? '').trim().toLowerCase();
  if (q) {
    const byCode = item.colors.find((c) => c.code === q.padStart(2, '0'));
    if (byCode) return { color: byCode, matched: true };
    const byName = item.colors.find((c) => c.name.toLowerCase() === q) ?? item.colors.find((c) => c.name.toLowerCase().includes(q));
    if (byName) return { color: byName, matched: true };
  }
  return { color: item.colors[0], matched: q === '' };
}

export interface ProductCard {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  slot: CatalogItem['slot'];
  shape: CatalogItem['shape'];
  fit: CatalogItem['fit'];
  color: { code: string; name: string; hex: string };
  image: string | null;
  /** Product page in this colour (through the affiliate template when one is set). */
  url: string;
  sizes: string[];
}

/** UNIQLO's product page in this colour; wrapped by AFFILIATE_URL_TEMPLATE ("...?u={url}") when it is set. */
export function productUrl(item: CatalogItem, colorCode: string, env: Record<string, string | undefined> = process.env): string {
  const page = `${item.url}?colorDisplayCode=${encodeURIComponent(colorCode)}`;
  const template = env.AFFILIATE_URL_TEMPLATE?.trim();
  return template && template.includes('{url}') ? template.replace('{url}', encodeURIComponent(page)) : page;
}

export function productCard(item: CatalogItem, colorCode: string): ProductCard {
  const color = findColor(item, colorCode);
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    salePrice: item.salePrice,
    slot: item.slot,
    shape: item.shape,
    fit: item.fit,
    color: { code: color.code, name: colorLabel(item, color.code), hex: color.hex },
    image: productImage(item, color.code) ?? null,
    url: productUrl(item, color.code),
    sizes: Array.isArray(item.sizes) ? item.sizes : [],
  };
}

export type Kind = 'tee' | 'sweater' | 'pants' | 'top' | 'bottom';

export interface SearchQuery {
  query?: string;
  kind?: Kind;
  color?: string;
  maxPrice?: number;
  limit?: number;
}

export const SEARCH_MAX = 12;

/** Catalog items for a free-text query and filters, best match first, each in the matching colour when one was asked. */
export function searchCatalog(q: SearchQuery): { item: CatalogItem; colorCode: string }[] {
  const wanted = words(q.query ?? '');
  const colorWanted = q.color?.trim().toLowerCase();
  const limit = Math.min(SEARCH_MAX, Math.max(1, Math.round(q.limit ?? 8)));
  const results: { item: CatalogItem; colorCode: string; score: number; order: number }[] = [];
  catalogItems().forEach((item, order) => {
    if (q.kind === 'top' || q.kind === 'bottom' ? item.slot !== q.kind : q.kind && item.shape !== q.kind) return;
    if (typeof q.maxPrice === 'number' && (item.salePrice ?? item.price) > q.maxPrice) return;
    let color = item.colors[0];
    if (colorWanted) {
      const match = item.colors.find((c) => c.name.toLowerCase().includes(colorWanted));
      if (!match) return;
      color = match;
    }
    const haystack = new Set(words(`${item.name} ${item.shape} ${item.fabric.replace(/_/g, ' ')} ${item.fit} ${item.slot}`));
    const colorWords = new Set(item.colors.flatMap((c) => words(c.name)));
    let score = 0;
    for (const w of wanted) {
      if (haystack.has(w)) score += 1;
      else if (colorWords.has(w)) {
        score += 0.5;
        if (!colorWanted) color = item.colors.find((c) => words(c.name).includes(w)) ?? color;
      }
    }
    if (wanted.length && score === 0) return;
    results.push({ item, colorCode: color.code, score, order });
  });
  return results
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ item, colorCode }) => ({ item, colorCode }));
}
