// The door in front of every new look: asks the server to charge one of the shopper's looks before a try-on starts
// (free ones first, then paid), opens the sign-in or buy dialog when it can't, and gives the look back when the try-on
// made no photo. The same look (same photo, same outfit) costs once: Try On Again, a retry and the side photo are free.
// The free try-on runs in the browser, so this is the honest shopper's gate, not a lock (CLAUDE.md, Paid try-ons).
import { trackAccount } from '../analytics';
import { chargeLook, refundLook } from './api';
import { useAccount } from './store';

/** Looks this tab has been charged for (or that were free), so asking again costs nothing and needs no network. */
const admitted = new Set<string>();

/** Forgets the looks this tab was admitted to (tests). */
export function forgetAdmitted(): void {
  admitted.clear();
}

/** A look's id: SHA-256 of what makes it (the photo and the garments), base64url. Never leaves the browser otherwise. */
export async function lookId(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Ticket {
  look: string;
  /** True when this admission spent a look (so a try-on that makes nothing should give it back). */
  charged: boolean;
}

/** True when this tab knows try-ons are free (billing off), so nothing needs asking. */
export function billingOff(): boolean {
  return useAccount.getState().view?.billing === false;
}

/**
 * Asks to start a look. Resolves to a ticket, or null when the shopper has to sign in or buy more first (the
 * dialog is already open). Billing off: always admitted, without asking the server. If this tab doesn't know yet
 * whether billing is on and the server can't be reached, the look goes ahead: a deployment without paid try-ons must
 * never be blocked by them.
 */
export async function admit(look: string, fetcher?: typeof fetch): Promise<Ticket | null> {
  const store = useAccount.getState();
  const view = store.view;
  if (billingOff() || admitted.has(look)) return { look, charged: false };
  if (view?.billing && !view.user) {
    store.openDialog({ kind: 'signin' });
    trackAccount('paywall', 'signin');
    return null;
  }
  const answer = await chargeLook(look, fetcher);
  const latest = answer.ok ? answer.data.account : answer.account;
  if (latest) store.setView(latest);
  if (answer.ok) {
    admitted.add(look);
    return { look, charged: answer.data.charged };
  }
  if (answer.code === 'signin') {
    store.openDialog({ kind: 'signin' });
    trackAccount('paywall', 'signin');
  } else if (answer.code === 'payment') {
    store.openDialog({ kind: 'buy' });
    trackAccount('paywall', 'buy');
  } else if (!useAccount.getState().view?.billing && (answer.status === 0 || answer.status === 404)) {
    console.warn('[account] billing unknown and the server is unreachable: trying on anyway');
    return { look, charged: false };
  } else {
    store.openDialog({ kind: 'error', message: answer.error });
  }
  return null;
}

/** The look made no photo: give it back (best effort; a failure leaves it charged and is only logged). */
export async function release(ticket: Ticket, fetcher?: typeof fetch): Promise<void> {
  admitted.delete(ticket.look);
  if (!ticket.charged) return;
  const answer = await refundLook(ticket.look, fetcher);
  if (answer.ok && answer.data.account) useAccount.getState().setView(answer.data.account);
}

// Another person signed in (or out) in this tab: their looks are theirs.
useAccount.subscribe((state, prev) => {
  if (state.view?.user?.email !== prev.view?.user?.email) admitted.clear();
});
