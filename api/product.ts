// POST /api/product { url } -> CatalogItem | { error, code }
// Builds UNIQLO API URLs from a parsed product ID (never fetches the user-supplied URL).
// Verified 2026-11-08: UNIQLO's commerce API answers server-side requests from Vercel functions.
import { sampleChipHex } from './_lib/chipColor';
import { json, readJson } from './_lib/http';
import { clientIp } from './_lib/rateLimit';
import { parseSizeChart, type SizeChart } from './_lib/sizeChart';
import { fallbackHex, parseProductId, swatchUrl, toCatalogItem, type CatalogItem } from './_lib/uniqlo';
import { fetchDetails, fetchSizeCharts, type FetchResult } from './_lib/uniqloClient';
import type { UniqloDetails } from './_lib/uniqlo';
import { createWindowLimiter } from './_lib/windowLimit';

// Worst case stays under vercel.json's maxDuration (20 s): details 6 + 0.3 + 6 s, then swatches (5 s timeout each,
// in parallel) = 17.3 s. Size charts run alongside details with the same budget.
const DETAILS_OPTS = { timeoutMs: 6000, retries: 1, retryDelayMs: 300 };
const SIZE_CHART_OPTS = { timeoutMs: 6000, retries: 1, retryDelayMs: 300 };
const MAX_INPUT_LENGTH = 500;
const NEGATIVE_TTL_MS = 60_000;
const MAX_NEGATIVE = 500;
const MAX_CACHED = 1000;
const REMEMBERED_FAILURES = new Set([404, 422]); // permanent answers; timeouts and 5xx may succeed on retry
const limiter = createWindowLimiter({ limit: 30, windowMs: 60_000 }); // per IP: plenty for a person pasting links
const cache = new Map<string, CatalogItem>();
const failures = new Map<string, { at: number; status: number; body: ErrorBody }>();
const pending = new Map<string, Promise<Lookup>>();

interface ErrorBody {
  error: string;
  code: string;
}

/** `complete` is false when an optional part (the size chart) failed, so the item is served but not cached. */
type Lookup = { ok: true; item: CatalogItem; complete: boolean } | { ok: false; status: number; body: ErrorBody };

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

export async function POST(request: Request): Promise<Response> {
  const verdict = limiter.hit(clientIp(request));
  if (!verdict.ok) {
    return json({ error: 'Too many product lookups. Wait a minute and try again.', code: 'rate_limited' }, 429, {
      'Retry-After': String(verdict.retryAfterS),
    });
  }

  const body = await readJson(request);
  const input = typeof body?.url === 'string' ? body.url.slice(0, MAX_INPUT_LENGTH) : '';
  const id = parseProductId(input);
  if (!id) return json({ error: 'Paste a UNIQLO product link like uniqlo.com/us/en/products/E453754-000/00', code: 'bad_input' }, 400);

  const cached = cache.get(id);
  if (cached) return json(cached);
  const failed = failures.get(id);
  if (failed && Date.now() - failed.at < NEGATIVE_TTL_MS) return json(failed.body, failed.status);

  // Share one upstream lookup between concurrent requests for the same product.
  let inFlight = pending.get(id);
  if (!inFlight) {
    inFlight = safeLookup(id).finally(() => pending.delete(id));
    pending.set(id, inFlight);
  }
  const result = await inFlight;
  remember(id, result);
  return result.ok ? json(result.item) : json(result.body, result.status);
}
