// POST /api/product { url } -> CatalogItem | { error, code }
// Builds the UNIQLO API URL from a parsed product ID (never fetches the user-supplied URL).
import { sampleChipHex } from './_lib/chipColor';
import { json, readJson } from './_lib/http';
import {
  detailsApiUrl,
  fallbackHex,
  parseProductId,
  swatchUrl,
  toCatalogItem,
  type CatalogItem,
  type UniqloDetails,
} from './_lib/uniqlo';

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_INPUT_LENGTH = 500;
const NEGATIVE_TTL_MS = 60_000;
const MAX_NEGATIVE = 500;
const cache = new Map<string, CatalogItem>();
const failures = new Map<string, { at: number; status: number; body: { error: string; code: string } }>();
const pending = new Map<string, Promise<Lookup>>();

type Lookup = { ok: true; item: CatalogItem } | { ok: false; status: number; body: { error: string; code: string } };

type Upstream = { ok: true; result: UniqloDetails } | { ok: false; status: number; code: string; error: string };

async function fetchDetails(id: string): Promise<Upstream> {
  try {
    const res = await fetch(detailsApiUrl(id), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: false, status: 404, code: 'not_found', error: `No UNIQLO product ${id}.` };
    if (!res.ok) return { ok: false, status: 502, code: 'blocked', error: `UNIQLO answered ${res.status}.` };
    const body = (await res.json()) as { status?: string; result?: UniqloDetails };
    if (body.status !== 'ok' || !body.result) {
      return { ok: false, status: 404, code: 'not_found', error: `No UNIQLO product ${id}.` };
    }
    return { ok: true, result: body.result };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.name : 'unknown';
    console.error('[api/product] upstream failure', id, reason);
    return { ok: false, status: 502, code: 'blocked', error: 'UNIQLO did not respond to the server.' };
  }
}

async function sampleColors(id: string, codes: string[]): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    codes.map(async (code) => [code, (await sampleChipHex(swatchUrl(id, code))) ?? fallbackHex(code)] as const),
  );
  return new Map(pairs);
}

async function lookup(id: string): Promise<Lookup> {
  const upstream = await fetchDetails(id);
  if (!upstream.ok) return { ok: false, status: upstream.status, body: { error: upstream.error, code: upstream.code } };
  const codes = (upstream.result.colors ?? []).map((c) => c.displayCode).filter((c): c is string => Boolean(c));
  const hexes = await sampleColors(id, codes);
  const mapped = toCatalogItem(id, upstream.result, (code) => hexes.get(code) ?? fallbackHex(code));
  if ('error' in mapped) return { ok: false, status: 422, body: { error: mapped.error, code: 'unsupported' } };
  return { ok: true, item: mapped.item };
}

function remember(id: string, result: Lookup): void {
  if (result.ok) {
    cache.set(id, result.item);
    return;
  }
  if (failures.size >= MAX_NEGATIVE) failures.clear();
  failures.set(id, { at: Date.now(), status: result.status, body: result.body });
}

export async function POST(request: Request): Promise<Response> {
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
    inFlight = lookup(id).finally(() => pending.delete(id));
    pending.set(id, inFlight);
  }
  const result = await inFlight;
  remember(id, result);
  return result.ok ? json(result.item) : json(result.body, result.status);
}
