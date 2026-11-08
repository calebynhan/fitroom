import type { CatalogColor, CatalogItem, Shape, Slot } from '@api/uniqlo';

export type { CatalogColor, CatalogItem, Shape, Slot };

export interface CatalogFile {
  source?: string;
  items: CatalogItem[];
}

export interface Selection {
  itemId: string;
  colorCode: string;
}

export function formatSizes(sizes: CatalogItem['sizes']): string {
  if (typeof sizes === 'string') return sizes;
  if (sizes.length === 0) return '';
  return sizes.length > 2 ? `${sizes[0]}-${sizes[sizes.length - 1]}` : sizes.join(', ');
}

export function formatPrice(item: CatalogItem): string {
  return `$${(item.salePrice ?? item.price).toFixed(2)}`;
}

export function findColor(item: CatalogItem, code: string): CatalogColor {
  return item.colors.find((c) => c.code === code) ?? item.colors[0];
}

function isItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CatalogItem>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    (v.slot === 'top' || v.slot === 'bottom') &&
    (v.shape === 'tee' || v.shape === 'sweater' || v.shape === 'pants') &&
    Array.isArray(v.colors) &&
    v.colors.length > 0
  );
}

/** Accepts `{ items: [...] }` or a bare array; drops malformed entries. */
export function parseCatalog(data: unknown): CatalogItem[] {
  const list = Array.isArray(data) ? data : (data as Partial<CatalogFile> | null)?.items;
  return Array.isArray(list) ? list.filter(isItem) : [];
}
