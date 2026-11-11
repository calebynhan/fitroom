// One UNIQLO product as a catalog item, by ID: details + size chart + swatch colours from UNIQLO's commerce API.
// Shared by POST /api/product and the ChatGPT plugin (api/mcp.ts). Caches per warm instance: complete items, and
// permanent failures (404 / 422) for a minute; concurrent lookups of one ID share a single upstream call.
// Verified 2026-11-08: UNIQLO's commerce API answers server-side requests from Vercel functions.
import { sampleChipHex } from './chipColor';
import { parseSizeChart, type SizeChart } from './sizeChart';
import { fallbackHex, swatchUrl, toCatalogItem, type CatalogItem, type UniqloDetails } from './uniqlo';
import { fetchDetails, fetchSizeCharts, type FetchResult } from './uniqloClient';

// Worst case stays under vercel.json's maxDuration (20 s): details 6 + 0.3 + 6 s, then swatches (5 s timeout each,
// in parallel) = 17.3 s. Size charts run alongside details with the same budget.
const DETAILS_OPTS = { timeoutMs: 6000, retries: 1, retryDelayMs: 300 };
const SIZE_CHART_OPTS = { timeoutMs: 6000, retries: 1, retryDelayMs: 300 };
const NEGATIVE_TTL_MS = 60_000;
const MAX_NEGATIVE = 500;
const MAX_CACHED = 1000;
const REMEMBERED_FAILURES = new Set([404, 422]); // permanent answers; timeouts and 5xx may succeed on retry
const cache = new Map<string, CatalogItem>();
const failures = new Map<string, { at: number; status: number; body: LookupError }>();
const pending = new Map<string, Promise<Lookup>>();

export interface LookupError {
  error: string;
  code: 'not_found' | 'unsupported' | 'blocked' | 'internal';
}

/** `complete` is false when an optional part (the size chart) failed, so the item is served but not cached. */
export type Lookup = { ok: true; item: CatalogItem; complete: boolean } | { ok: false; status: number; body: LookupError };

function upstreamError(id: string, res: Extract<FetchResult<UniqloDetails>, { ok: false }>): Lookup {
  if (res.status === 404) return { ok: false, status: 404, body: { error: `No UNIQLO product ${id}.`, code: 'not_found' } };
  console.error('[api/product] details failed', id, res.status, res.reason);
  return { ok: false, status: 502, body: { error: 'UNIQLO did not respond to the server.', code: 'blocked' } };
}

async function sampleColors(id: string, codes: string[]): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    codes.map(async (code) => [code, (await sampleChipHex(swatchUrl(id, code))) ?? fallbackHex(code)] as const),
  );
  return new Map(pairs);
}

/** The parsed size chart, or null. A 404 means "no chart" (final); other failures are logged and not cached. */
async function loadSizeChart(id: string): Promise<{ chart: SizeChart | null; failed: boolean }> {
  const res = await fetchSizeCharts([id], SIZE_CHART_OPTS);
  if (res.ok) return { chart: parseSizeChart(res.data.get(id)).chart, failed: false };
  if (res.status === 404) return { chart: null, failed: false };
  console.error('[api/product] size chart failed', id, res.status, res.reason);
  return { chart: null, failed: true };
}

async function lookup(id: string): Promise<Lookup> {
  const [details, sizeChart] = await Promise.all([fetchDetails(id, DETAILS_OPTS), loadSizeChart(id)]);
  if (!details.ok) return upstreamError(id, details);
  const colors = Array.isArray(details.data.colors) ? details.data.colors : [];
  const codes = colors.map((c) => c?.displayCode).filter((c): c is string => typeof c === 'string');
  const hexes = await sampleColors(id, codes);
  const mapped = toCatalogItem(id, details.data, (code) => hexes.get(code) ?? fallbackHex(code), sizeChart.chart);
  if ('error' in mapped) return { ok: false, status: 422, body: { error: mapped.error, code: 'unsupported' } };
  return { ok: true, item: mapped.item, complete: !sizeChart.failed };
}

async function safeLookup(id: string): Promise<Lookup> {
  try {
    return await lookup(id);
  } catch (err: unknown) {
    console.error('[api/product] unexpected failure', id, err instanceof Error ? err.stack ?? err.message : err);
    return { ok: false, status: 500, body: { error: 'Something went wrong loading that product. Try again.', code: 'internal' } };
  }
}

function remember(id: string, result: Lookup): void {
  if (result.ok) {
    if (!result.complete) return;
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(id, result.item);
    return;
  }
  if (!REMEMBERED_FAILURES.has(result.status)) return;
  if (failures.size >= MAX_NEGATIVE) failures.clear();
  failures.set(id, { at: Date.now(), status: result.status, body: result.body });
}

/** The product with this ID ("E453754-000"), from the cache or UNIQLO. Never throws. */
export async function getProduct(id: string): Promise<Lookup> {
  const cached = cache.get(id);
  if (cached) return { ok: true, item: cached, complete: true };
  const failed = failures.get(id);
  if (failed && Date.now() - failed.at < NEGATIVE_TTL_MS) return { ok: false, status: failed.status, body: failed.body };

  // Share one upstream lookup between concurrent requests for the same product.
  let inFlight = pending.get(id);
  if (!inFlight) {
    inFlight = safeLookup(id).finally(() => pending.delete(id));
    pending.set(id, inFlight);
  }
  const result = await inFlight;
  remember(id, result);
  return result;
}
