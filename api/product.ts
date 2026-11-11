// POST /api/product { url } -> CatalogItem | { error, code }
// Builds UNIQLO API URLs from a parsed product ID (never fetches the user-supplied URL). The lookup itself (and its
// caches) lives in _lib/productLookup.ts, shared with the ChatGPT plugin.
import { json, readJson } from './_lib/http';
import { getProduct } from './_lib/productLookup';
import { clientIp } from './_lib/rateLimit';
import { parseProductId } from './_lib/uniqlo';
import { createWindowLimiter } from './_lib/windowLimit';

const MAX_INPUT_LENGTH = 500;
const limiter = createWindowLimiter({ limit: 30, windowMs: 60_000 }); // per IP: plenty for a person pasting links

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

  const result = await getProduct(id);
  return result.ok ? json(result.item) : json(result.body, result.status);
}
