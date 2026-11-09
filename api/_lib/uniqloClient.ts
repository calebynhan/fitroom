// Thin I/O layer over UNIQLO US's public commerce API, shared by /api/product and scripts/build-catalog.ts.
// Only builds URLs from validated product IDs and fixed category paths; never fetches caller-supplied URLs.
// Type-only relative imports (erased at runtime) keep this a leaf module that Node can run from .ts directly.
import type { UniqloSizeChartEntry } from './sizeChart';
import type { UniqloDetails } from './uniqlo';

const API_BASE = 'https://www.uniqlo.com/us/api/commerce/v5/en';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_DELAY_MS = 600;
const DEFAULT_SIZE_CHART_BATCH = 10;
const DEFAULT_PAGE_SIZE = 100;
const MAX_LISTING_PAGES = 20;

export type FetchResult<T> = { ok: true; data: T } | { ok: false; status: number; reason: string };

export interface FetchOptions {
  timeoutMs?: number;
  /** Extra attempts after the first, for network errors, 429 and 5xx only. */
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/** The listing fields the ingest script uses to pick items before fetching details. */
export interface UniqloListingItem {
  productId?: string;
  name?: string;
  priceGroup?: string;
  genderCategory?: string;
  sizeGender?: string;
  rating?: { average?: number; count?: number };
}

export function detailsApiUrl(id: string): string {
  return `${API_BASE}/products/${id}/price-groups/00/details?includeModelSize=false&httpFailure=true`;
}

export function sizeChartsApiUrl(ids: string[]): string {
  const query = new URLSearchParams({
    productIdsWithColorCode: ids.join(','),
    includeBodyMeasurements: 'true',
    simpleSizeChart: 'false',
    httpFailure: 'true',
  });
  return `${API_BASE}/products/size-charts?${query}`;
}

export function listingApiUrl(path: string, offset: number, limit: number): string {
  return `${API_BASE}/products?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}&httpFailure=true`;
}

function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function fetchOnce<T>(url: string, opts: FetchOptions): Promise<FetchResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: false, status: 404, reason: 'not found' };
    if (!res.ok) return { ok: false, status: res.status, reason: `UNIQLO answered ${res.status}` };
    const body = (await res.json().catch(() => null)) as { status?: string; result?: T } | null;
    if (!body) return { ok: false, status: 502, reason: 'UNIQLO sent something that is not JSON' };
    if (body.status !== 'ok') return { ok: false, status: 404, reason: 'UNIQLO said "nok"' };
    if (body.result === null || typeof body.result !== 'object') {
      return { ok: false, status: 502, reason: 'UNIQLO sent an unexpected result' };
    }
    return { ok: true, data: body.result };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'unknown';
    return { ok: false, status: 0, reason: name === 'TimeoutError' ? 'timed out' : `network error (${name})` };
  }
}

/** GET a UNIQLO `{ status: "ok", result }` endpoint with timeout and bounded, backed-off retries. */
export async function fetchUniqlo<T>(url: string, opts: FetchOptions = {}): Promise<FetchResult<T>> {
  const retries = Math.max(0, opts.retries ?? 0);
  const delay = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let last: FetchResult<T> = { ok: false, status: 0, reason: 'not attempted' };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(delay * 2 ** (attempt - 1));
    last = await fetchOnce<T>(url, opts);
    if (last.ok || !isRetryable(last.status)) return last;
  }
  return last;
}

export function fetchDetails(id: string, opts: FetchOptions = {}): Promise<FetchResult<UniqloDetails>> {
  return fetchUniqlo<UniqloDetails>(detailsApiUrl(id), opts);
}

function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, size);
  return Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, i * n + n));
}

/** Size charts for many products, keyed by productId. Any failed batch fails the call. */
export async function fetchSizeCharts(
  ids: string[],
  opts: FetchOptions & { batchSize?: number } = {},
): Promise<FetchResult<Map<string, UniqloSizeChartEntry>>> {
  const entries: UniqloSizeChartEntry[] = [];
  for (const batch of chunk(ids, opts.batchSize ?? DEFAULT_SIZE_CHART_BATCH)) {
    const res = await fetchUniqlo<UniqloSizeChartEntry[]>(sizeChartsApiUrl(batch), opts);
    if (!res.ok) return res;
    entries.push(...(Array.isArray(res.data) ? res.data : []));
  }
  const keyed = entries.filter((e) => typeof e?.productId === 'string').map((e) => [e.productId as string, e] as const);
  return { ok: true, data: new Map(keyed) };
}

interface ListingPage {
  items?: UniqloListingItem[];
  pagination?: { total?: number };
}

/** Every product under a category path such as "22211,95668,95670," (gender, class, category, subcategory). */
export async function fetchListing(
  path: string,
  opts: FetchOptions & { pageSize?: number } = {},
): Promise<FetchResult<UniqloListingItem[]>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const items: UniqloListingItem[] = [];
  for (let page = 0; page < MAX_LISTING_PAGES; page += 1) {
    const res = await fetchUniqlo<ListingPage>(listingApiUrl(path, items.length, pageSize), opts);
    if (!res.ok) return res;
    const batch = Array.isArray(res.data.items) ? res.data.items : [];
    items.push(...batch);
    const total = res.data.pagination?.total ?? 0;
    if (batch.length === 0 || items.length >= total) break;
  }
  return { ok: true, data: items };
}
