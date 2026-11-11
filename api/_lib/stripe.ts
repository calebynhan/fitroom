// Stripe Checkout over its REST API (no SDK): create a hosted payment page for one pack of looks, read a finished
// session back, and verify webhook signatures. The pack (looks, amount) is set here on the server, never by the browser.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pack } from './billing';
import type { SessionUser } from './session';

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 10_000;
/** A webhook older than this is refused (replays). */
export const WEBHOOK_TOLERANCE_S = 300;

export interface CheckoutSession {
  id: string;
  url: string | null;
  /** 'paid' once the money is in ('unpaid' / 'no_payment_required' otherwise). */
  payment_status: string;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(secretKey: string, path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secretKey}`, ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: unknown) {
    throw new StripeError(`Stripe unreachable: ${err instanceof Error ? err.name : 'unknown'}`, 502);
  }
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new StripeError(`Stripe HTTP ${res.status}: ${data?.error?.message ?? 'no detail'}`, res.status);
  return data;
}

/** The form body of a Checkout Session for one pack, paid by `user`, returning to `origin`. */
export function checkoutForm(pack: Pack, user: SessionUser, origin: string): URLSearchParams {
  const form = new URLSearchParams({
    mode: 'payment',
    client_reference_id: user.sub,
    customer_email: user.email,
    success_url: `${origin}/?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    'line_items[0][quantity]': '1',
    'metadata[looks]': String(pack.looks),
    'metadata[email]': user.email,
    'payment_intent_data[description]': `FitRoom: ${pack.looks} try-ons`,
  });
  if (pack.priceId) {
    form.set('line_items[0][price]', pack.priceId);
  } else {
    form.set('line_items[0][price_data][currency]', pack.currency);
    form.set('line_items[0][price_data][unit_amount]', String(pack.amount));
    form.set('line_items[0][price_data][product_data][name]', `FitRoom: ${pack.looks} try-ons`);
    form.set('line_items[0][price_data][product_data][description]', 'Photos of you in the outfit, from your own photo.');
  }
  return form;
}

export async function createCheckout(secretKey: string, pack: Pack, user: SessionUser, origin: string): Promise<CheckoutSession> {
  return (await call(secretKey, '/checkout/sessions', { method: 'POST', body: checkoutForm(pack, user, origin) })) as CheckoutSession;
}

export async function getCheckout(secretKey: string, id: string): Promise<CheckoutSession> {
  return (await call(secretKey, `/checkout/sessions/${encodeURIComponent(id)}`)) as CheckoutSession;
}

export const CHECKOUT_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{8,200}$/;

/** Who paid and for how many looks, if this session is paid for. */
export function paidPack(session: CheckoutSession): { sub: string; email: string; looks: number } | null {
  const looks = Number(session.metadata?.looks);
  const sub = session.client_reference_id;
  if (session.payment_status !== 'paid' || !sub || !Number.isInteger(looks) || looks <= 0) return null;
  return { sub, email: session.metadata?.email ?? '', looks };
}

export function signWebhook(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

/** The event in a webhook body whose Stripe-Signature header is genuine and recent, else null. */
export function verifyWebhook(payload: string, header: string | null, secret: string, nowS: number = Date.now() / 1000): unknown {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(timestamp) || signatures.length === 0 || Math.abs(nowS - timestamp) > WEBHOOK_TOLERANCE_S) return null;
  const expected = Buffer.from(signWebhook(payload, secret, timestamp));
  const genuine = signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!genuine) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}
