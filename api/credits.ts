// POST /api/credits { action: "charge" | "refund", look } -> { ok, charged?, account } | { error, code, account? }
// The free try-on runs in the shopper's browser, so the browser asks here before each new look: "charge" spends one
// (free first, then paid; the same look again costs nothing), "refund" gives it back when the try-on made no photo.
// `look` is the browser's digest of the photo and outfit. 401 signin, 402 payment (out of looks), 400 bad_input,
// 429 rate_limited, 503 unavailable. Billing off: always { ok: true }.
import { admit, asker, giveBack, LOOK_ID_RE } from './_lib/account';
import { json, readJson } from './_lib/http';
import { clientIp } from './_lib/rateLimit';
import { createWindowLimiter } from './_lib/windowLimit';

const limiter = createWindowLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(request: Request): Promise<Response> {
  const verdict = limiter.hit(clientIp(request));
  if (!verdict.ok) {
    return json({ error: 'Too many requests. Wait a minute and try again.', code: 'rate_limited' }, 429, { 'Retry-After': String(verdict.retryAfterS) });
  }
  const body = await readJson(request);
  const look = typeof body?.look === 'string' && LOOK_ID_RE.test(body.look) ? body.look : null;
  if (!look || (body?.action !== 'charge' && body?.action !== 'refund')) return json({ error: 'Bad request.', code: 'bad_input' }, 400);

  const who = asker(request);
  if (body.action === 'refund') {
    const account = await giveBack(who, look);
    return json({ ok: true, ...(account ? { account } : {}) });
  }
  const admission = await admit(who, look);
  if (!admission.ok) return json({ error: admission.error, code: admission.code, account: admission.view }, admission.status);
  return json({ ok: true, charged: admission.charged, account: admission.view });
}
