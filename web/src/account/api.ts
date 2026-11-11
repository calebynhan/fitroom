// The billing endpoints, from the browser: /api/account, /api/credits, /api/checkout. Every answer is either the data
// or a shopper-facing error (with the server's `code` and its latest view of the account, when it sent one).
import type { AccountView, BillingCode } from '@api/accountTypes';

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: BillingCode | string; account?: AccountView };

const UNREACHABLE = "Couldn't reach FitRoom. Check your connection and try again.";

export async function call<T>(path: string, body?: object, fetcher: typeof fetch = fetch): Promise<Answer<T>> {
  try {
    const res = await fetcher(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string; account?: AccountView }) | null;
    if (!data) return { ok: false, status: res.status, error: res.ok ? 'Unexpected answer from FitRoom. Try again.' : `FitRoom answered ${res.status}. Try again.` };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `FitRoom answered ${res.status}. Try again.`, code: data.code, account: data.account };
    return { ok: true, data };
  } catch (err: unknown) {
    console.error('[account] request failed', path, err);
    return { ok: false, status: 0, error: UNREACHABLE };
  }
}

export const getAccount = (fetcher?: typeof fetch) => call<AccountView>('/api/account', undefined, fetcher);
export const signInWith = (credential: string) => call<AccountView>('/api/account', { action: 'signin', credential });
export const signOutNow = () => call<AccountView>('/api/account', { action: 'signout' });
export const chargeLook = (look: string, fetcher?: typeof fetch) =>
  call<{ ok: true; charged: boolean; account?: AccountView }>('/api/credits', { action: 'charge', look }, fetcher);
export const refundLook = (look: string, fetcher?: typeof fetch) => call<{ ok: true; account?: AccountView }>('/api/credits', { action: 'refund', look }, fetcher);
export const startCheckoutSession = () => call<{ url: string }>('/api/checkout', { action: 'start' });
export const confirmCheckoutSession = (sessionId: string) => call<{ added: number; account: AccountView }>('/api/checkout', { action: 'confirm', sessionId });
