import type { CatalogItem } from './types';

export type ProductResponse = CatalogItem | { error: string; code?: string };

/** Any UNIQLO US product link -> a catalog item, via /api/product (see CLAUDE.md for the error codes). */
export async function fetchProduct(url: string): Promise<ProductResponse> {
  try {
    const res = await fetch('/api/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return (await res.json()) as ProductResponse;
  } catch {
    return { error: 'Could not reach the server.', code: 'blocked' };
  }
}
