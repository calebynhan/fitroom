// POST /api/checkout { action: "start" }                -> { url } (Stripe's hosted payment page for one pack)
// POST /api/checkout { action: "confirm", sessionId }   -> { added, account } (after Stripe sends the shopper back)
// "confirm" credits a paid session straight away; the webhook (api/stripe.ts) credits it too if the shopper never comes
// back. Either way a session counts once. 400 bad_input, 401 signin, 403 not yours, 409 not paid, 429, 502/503.
import { asker, siteOrigin, viewFor } from './_lib/account';
import { isExempt } from './_lib/billing';
import { fromThisSite, json, readJson } from './_lib/http';
import { ledger } from './_lib/ledger';
import { clientIp } from './_lib/rateLimit';
import { CHECKOUT_ID_RE, createCheckout, getCheckout, paidPack, StripeError } from './_lib/stripe';
import { createWindowLimiter } from './_lib/windowLimit';

const limiter = createWindowLimiter({ limit: 20, windowMs: 60_000 });

function failed(err: unknown, what: 'start' | 'confirm'): Response {
  console.error(`[api/checkout] ${what} failed`, err instanceof Error ? err.message : err);
  const status = err instanceof StripeError ? 502 : 503;
  const error =
    what === 'start'
      ? "Couldn't reach the payment page. Nothing was charged; try again in a moment."
      : "Couldn't confirm the payment just now. If it went through, your try-ons are added automatically within a few minutes.";
  return json({ error, code: 'unavailable' }, status);
}

export async function POST(request: Request): Promise<Response> {
  const verdict = limiter.hit(clientIp(request));
  if (!verdict.ok) {
    return json({ error: 'Too many requests. Wait a minute and try again.', code: 'rate_limited' }, 429, { 'Retry-After': String(verdict.retryAfterS) });
  }
  if (!fromThisSite(request)) return json({ error: 'Bad request.', code: 'bad_input' }, 403);
  const who = asker(request);
  const { config, user } = who;
  const body = await readJson(request);
  if (!config.enabled || !config.stripeKey) return json({ error: "Buying try-ons isn't open yet.", code: 'unavailable' }, 503);
  if (!user) return json({ error: 'Sign in first.', code: 'signin' }, 401);

  if (body?.action === 'start') {
    if (isExempt(user.email)) return json({ error: 'Your try-ons are unlimited: nothing to buy.', code: 'bad_input' }, 400);
    try {
      const session = await createCheckout(config.stripeKey, config.pack, user, siteOrigin(request));
      if (!session.url) throw new Error('no checkout url');
      return json({ url: session.url });
    } catch (err: unknown) {
      return failed(err, 'start');
    }
  }

  if (body?.action === 'confirm') {
    const id = typeof body.sessionId === 'string' && CHECKOUT_ID_RE.test(body.sessionId) ? body.sessionId : null;
    if (!id) return json({ error: 'Bad request.', code: 'bad_input' }, 400);
    try {
      const pack = paidPack(await getCheckout(config.stripeKey, id));
      if (!pack) return json({ error: "This payment hasn't gone through yet.", code: 'not_paid' }, 409);
      if (pack.sub !== user.sub) return json({ error: 'This payment belongs to another account.', code: 'forbidden' }, 403);
      const { credited } = await ledger().credit(user.sub, user.email, id, pack.looks);
      return json({ added: credited ? pack.looks : 0, account: await viewFor(who) });
    } catch (err: unknown) {
      return failed(err, 'confirm');
    }
  }
  return json({ error: 'Unknown action.', code: 'bad_input' }, 400);
}
