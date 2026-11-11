// POST /api/stripe: Stripe's webhook. Set it up in the Stripe dashboard (Developers > Webhooks) for
// https://<site>/api/stripe with the events checkout.session.completed and checkout.session.async_payment_succeeded,
// and put its signing secret in STRIPE_WEBHOOK_SECRET. A paid session adds its pack to the account that started it,
// once (api/checkout.ts "confirm" may have done so already). 400 = bad signature; 500 = try again later (Stripe retries).
import { billingConfig } from './_lib/billing';
import { json } from './_lib/http';
import { ledger, ledgerConfigured } from './_lib/ledger';
import { paidPack, verifyWebhook, type CheckoutSession } from './_lib/stripe';

const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

interface StripeEvent {
  type?: string;
  data?: { object?: CheckoutSession };
}

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();
  if (!config.stripeWebhookSecret) {
    console.error('[api/stripe] STRIPE_WEBHOOK_SECRET is not set');
    return json({ error: 'not configured' }, 503);
  }
  // No shared ledger (KV variables missing): crediting per-instance memory would lose the purchase. 503 makes Stripe retry.
  if (!ledgerConfigured()) {
    console.error('[api/stripe] no ledger (KV_REST_API_URL / KV_REST_API_TOKEN): not crediting, Stripe will retry');
    return json({ error: 'ledger not configured' }, 503);
  }
  const payload = await request.text();
  const event = verifyWebhook(payload, request.headers.get('stripe-signature'), config.stripeWebhookSecret) as StripeEvent | null;
  if (!event) return json({ error: 'bad signature' }, 400);
  if (!PAID_EVENTS.has(event.type ?? '')) return json({ received: true });

  const session = event.data?.object;
  const pack = session ? paidPack(session) : null;
  if (!session || !pack) return json({ received: true }); // not paid yet (async methods report again when they settle)
  try {
    const { credited } = await ledger().credit(pack.sub, pack.email, session.id, pack.looks);
    console.log('[api/stripe] checkout', session.id, credited ? `credited ${pack.looks}` : 'already credited');
    return json({ received: true });
  } catch (err: unknown) {
    console.error('[api/stripe] ledger failed', err instanceof Error ? err.message : err);
    return json({ error: 'ledger unavailable' }, 500);
  }
}
