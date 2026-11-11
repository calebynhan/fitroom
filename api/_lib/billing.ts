// Paid try-ons: every person gets FREE_LOOKS free looks (a new outfit, or the same outfit with one piece changed),
// then buys a pack. "Person" = a Google account (sign-in); the count lives in the ledger (ledger.ts), never photos.
// Off unless configured (GOOGLE_CLIENT_ID + SESSION_SECRET + a ledger): then the app works as before, free and open.
// Buying needs Stripe on top (STRIPE_SECRET_KEY); without it the free looks still count and the paywall says so.
import { createHash } from 'node:crypto';
import type { AccountView, Balance } from './accountTypes';
import { ledgerConfigured } from './ledger';

export type { AccountUser, AccountView, Balance } from './accountTypes';

export const DEFAULT_FREE_LOOKS = 5;
export const DEFAULT_PACK_LOOKS = 20;
export const DEFAULT_PACK_CENTS = 499;
const DEFAULT_CURRENCY = 'usd';
const MIN_SECRET_CHARS = 32;

/** The owner's account never pays. Stored as a SHA-256 so the address isn't in the repository. */
const OWNER_EMAIL_SHA256 = new Set(['5156d39c2bb60794d87ff7009bccc4f39a161ea80b2b146661984f03fa1238cc']);

export interface Pack {
  looks: number;
  /** Price in the currency's smallest unit (cents). */
  amount: number;
  currency: string;
  /** A Stripe Price to charge instead of `amount` (its amount should match, for the label). */
  priceId: string | null;
}

export interface BillingConfig {
  enabled: boolean;
  freeLooks: number;
  googleClientId: string | null;
  sessionSecret: string | null;
  /** Stripe secret key; null = buying isn't set up (the free looks still count). */
  stripeKey: string | null;
  stripeWebhookSecret: string | null;
  pack: Pack;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || null;
  const secret = env.SESSION_SECRET?.trim() || null;
  const sessionSecret = secret && secret.length >= MIN_SECRET_CHARS ? secret : null;
  if (secret && !sessionSecret) console.error(`[billing] SESSION_SECRET must be at least ${MIN_SECRET_CHARS} characters; paid try-ons are off`);
  const ledger = ledgerConfigured(env);
  if (googleClientId && sessionSecret && !ledger) console.error('[billing] no ledger (KV_REST_API_URL / KV_REST_API_TOKEN); paid try-ons are off');
  return {
    enabled: env.BILLING_DISABLED !== '1' && Boolean(googleClientId && sessionSecret && ledger),
    freeLooks: nonNegativeInt(env.FREE_LOOKS, DEFAULT_FREE_LOOKS),
    googleClientId,
    sessionSecret,
    stripeKey: env.STRIPE_SECRET_KEY?.trim() || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    pack: {
      looks: positiveInt(env.PACK_LOOKS, DEFAULT_PACK_LOOKS),
      amount: positiveInt(env.PACK_PRICE_CENTS, DEFAULT_PACK_CENTS),
      currency: (env.PACK_CURRENCY?.trim() || DEFAULT_CURRENCY).toLowerCase(),
      priceId: env.STRIPE_PRICE_ID?.trim() || null,
    },
  };
}

export function normalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True for accounts that never pay: the owner, and anyone in BILLING_EXEMPT_EMAILS (comma-separated). */
export function isExempt(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const e = normalEmail(email);
  if (OWNER_EMAIL_SHA256.has(createHash('sha256').update(e).digest('hex'))) return true;
  return (env.BILLING_EXEMPT_EMAILS ?? '')
    .split(',')
    .map(normalEmail)
    .some((x) => x !== '' && x === e);
}

export function formatPrice(pack: Pick<Pack, 'amount' | 'currency'>): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: pack.currency.toUpperCase() }).format(pack.amount / 100);
  } catch {
    return `${(pack.amount / 100).toFixed(2)} ${pack.currency.toUpperCase()}`;
  }
}

export function looksLeft(config: Pick<BillingConfig, 'freeLooks'>, balance: Balance, exempt: boolean): number | null {
  return exempt ? null : Math.max(0, config.freeLooks - balance.freeUsed) + Math.max(0, balance.credits);
}

export function accountView(config: BillingConfig, user: { email: string; balance: Balance } | null): AccountView {
  if (!config.enabled) return { billing: false, googleClientId: null, freeLooks: config.freeLooks, pack: null, user: null };
  const exempt = user ? isExempt(user.email) : false;
  return {
    billing: true,
    googleClientId: config.googleClientId,
    freeLooks: config.freeLooks,
    pack: config.stripeKey ? { looks: config.pack.looks, price: formatPrice(config.pack) } : null,
    user: user
      ? {
          email: user.email,
          exempt,
          freeUsed: Math.min(config.freeLooks, Math.max(0, user.balance.freeUsed)),
          credits: Math.max(0, user.balance.credits),
          left: looksLeft(config, user.balance, exempt),
        }
      : null,
  };
}
