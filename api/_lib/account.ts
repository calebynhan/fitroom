// What the billing endpoints share: who is asking, their looks, and charging one look (or not, for the owner).
import { accountView, billingConfig, isExempt, type AccountView, type BillingConfig } from './billing';
import { ledger, LedgerError } from './ledger';
import { readSession, type SessionUser } from './session';

/** A look id from the browser: a digest of the photo and the outfit (tryon/shoot.ts). Server-made ids carry a ':'. */
export const LOOK_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const SIGN_IN_MESSAGE = 'Sign in to try clothes on. Your first looks are free.';

export function outOfLooksMessage(config: BillingConfig): string {
  if (config.freeLooks <= 0) return 'Buy try-ons to carry on.';
  return config.freeLooks === 1 ? "You've used your free try-on." : `You've used your ${config.freeLooks} free try-ons.`;
}

export interface Asker {
  config: BillingConfig;
  user: SessionUser | null;
}

export function asker(request: Request, config: BillingConfig = billingConfig()): Asker {
  return { config, user: config.enabled ? readSession(request, config.sessionSecret) : null };
}

/** The account as the browser sees it. Throws LedgerError when the ledger can't be read. */
export async function viewFor({ config, user }: Asker): Promise<AccountView> {
  if (!config.enabled || !user) return accountView(config, null);
  const balance = isExempt(user.email) ? { freeUsed: 0, credits: 0 } : await ledger().balance(user.sub);
  return accountView(config, { email: user.email, balance });
}

export type Admission =
  | { ok: true; view: AccountView; /** True when this request charged the look (so a failure can give it back). */ charged: boolean }
  /** `view` is left out when the ledger is down: an empty one would make a signed-in shopper look signed out. */
  | { ok: false; status: 401 | 402 | 503; error: string; code: 'signin' | 'payment' | 'unavailable'; view?: AccountView };

/** Charges `look` to the asker unless billing is off, they never pay, or the look was charged before. */
export async function admit(who: Asker, look: string): Promise<Admission> {
  const { config, user } = who;
  if (!config.enabled) return { ok: true, view: accountView(config, null), charged: false };
  if (!user) return { ok: false, status: 401, error: SIGN_IN_MESSAGE, code: 'signin', view: accountView(config, null) };
  if (isExempt(user.email)) return { ok: true, view: accountView(config, { email: user.email, balance: { freeUsed: 0, credits: 0 } }), charged: false };
  try {
    const result = await ledger().charge(user.sub, user.email, look, config.freeLooks);
    const view = accountView(config, { email: user.email, balance: result.balance });
    if (!result.ok) return { ok: false, status: 402, error: outOfLooksMessage(config), code: 'payment', view };
    return { ok: true, view, charged: result.source !== 'repeat' };
  } catch (err: unknown) {
    console.error('[billing] charge failed', err instanceof Error ? err.message : err);
    return { ok: false, status: 503, error: "Couldn't check your try-ons. Try again in a moment.", code: 'unavailable' };
  }
}

/** Gives a look back (it made no photo). Never throws: a refund that fails is logged and the look stays charged. */
export async function giveBack(who: Asker, look: string): Promise<AccountView | null> {
  const { config, user } = who;
  if (!config.enabled || !user || isExempt(user.email)) return null;
  try {
    const result = await ledger().refund(user.sub, look);
    return accountView(config, { email: user.email, balance: result.balance });
  } catch (err: unknown) {
    console.error('[billing] refund failed', err instanceof LedgerError ? err.message : err);
    return null;
  }
}

/** This site's own origin, for Stripe's return links. APP_URL wins (a custom domain); else the request's host. */
export function siteOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const fixed = env.APP_URL?.trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
