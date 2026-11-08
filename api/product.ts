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
const cache = new Map<string, CatalogItem>();

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

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const input = typeof body?.url === 'string' ? body.url.slice(0, MAX_INPUT_LENGTH) : '';
  const id = parseProductId(input);
  if (!id) return json({ error: 'Paste a UNIQLO product link like uniqlo.com/us/en/products/E453754-000/00', code: 'bad_input' }, 400);

  const cached = cache.get(id);
  if (cached) return json(cached);

  const upstream = await fetchDetails(id);
  if (!upstream.ok) return json({ error: upstream.error, code: upstream.code }, upstream.status);

  const codes = (upstream.result.colors ?? []).map((c) => c.displayCode).filter((c): c is string => Boolean(c));
  const hexes = await sampleColors(id, codes);
  const mapped = toCatalogItem(id, upstream.result, (code) => hexes.get(code) ?? fallbackHex(code));
  if ('error' in mapped) return json({ error: mapped.error, code: 'unsupported' }, 422);

  cache.set(id, mapped.item);
  return json(mapped.item);
}
