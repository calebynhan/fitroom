import type { CatalogColor, CatalogItem, Shape, SizeSpec, Slot } from '../uniqlo';

export type { CatalogColor, CatalogItem, Shape, SizeSpec, Slot };

export interface CatalogFile {
  source?: string;
  items: CatalogItem[];
}

export interface Selection {
  itemId: string;
  colorCode: string;
  /** Chosen size; undefined = the recommended size for the shopper's body. */
  size?: string;
}

/** Product photo of this item in this colour (UNIQLO's own shot), if any. */
export function productImage(item: CatalogItem, code: string): string | undefined {
  return findColor(item, code).image ?? colorImage(item.image, code);
}

/** UNIQLO product shots follow usgoods_<colour>_<num>_3x4.jpg. */
export function colorImage(image: string | undefined, code: string): string | undefined {
  return image?.replace(/usgoods_\d{2}_/, `usgoods_${code}_`);
}

export function formatSizes(sizes: CatalogItem['sizes']): string {
  if (typeof sizes === 'string') return sizes;
  if (sizes.length === 0) return '';
  return sizes.length > 2 ? `${sizes[0]}-${sizes[sizes.length - 1]}` : sizes.join(', ');
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(amount: number): string {
  return USD.format(amount);
}

export function formatPrice(item: CatalogItem): string {
  return formatMoney(item.salePrice ?? item.price);
}

/**
 * The colour's name, with UNIQLO's colour code when another colourway of the item has the same name (10/34 items
 * do, e.g. Crew Neck T-Shirt: three "Blue"). UNIQLO's own site shows them the same way ("67 BLUE").
 */
export function colorLabel(item: CatalogItem, code: string): string {
  const color = findColor(item, code);
  const twins = item.colors.filter((c) => c.name === color.name).length;
  return twins > 1 ? `${color.name} (${color.code})` : color.name;
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
