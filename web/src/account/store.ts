// The shopper's account as this tab knows it: whether try-ons are counted (billing), who is signed in, looks left,
// and the account dialog (sign in, buy more, waiting for a payment, thanks). The server is the authority: every
// billing answer carries its latest view, which replaces this one.
import { create } from 'zustand';
import type { AccountUser, AccountView } from '@api/accountTypes';
import { trackAccount } from '../analytics';
import { getAccount, signInWith, signOutNow } from './api';

export type DialogKind = 'signin' | 'buy' | 'waiting' | 'thanks' | 'cancelled' | 'error';

export interface AccountDialog {
  kind: DialogKind;
  /** Error or extra explanation shown in the dialog. */
  message?: string;
  /** 'thanks': looks just added. */
  added?: number;
  /** This tab was opened by Stripe's return link (the shopper's photos are in the other tab). */
  returnTab?: boolean;
  /** Paid in this same tab: the photos (memory only) are gone, so the shopper adds them again. */
  photosLost?: boolean;
}

interface AccountStore {
  /** Null until the first answer from /api/account. */
  view: AccountView | null;
  dialog: AccountDialog | null;
  /** A sign-in, sign-out or checkout request is in flight. */
  pending: boolean;
  setView: (view: AccountView) => void;
  openDialog: (dialog: AccountDialog) => void;
  closeDialog: () => void;
  setPending: (pending: boolean) => void;
}

export const useAccount = create<AccountStore>()((set) => ({
  view: null,
  dialog: null,
  pending: false,
  setView: (view) => set({ view }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setPending: (pending) => set({ pending }),
}));

/** Fetches the account (on start, after a payment, when the tab comes back into view). Keeps the old view on failure. */
export async function loadAccount(fetcher?: typeof fetch): Promise<AccountView | null> {
  const answer = await getAccount(fetcher);
  const view = answer.ok ? answer.data : answer.account;
  if (view) useAccount.getState().setView(view);
  return view ?? null;
}

/** Google Sign-In handed us a credential: trade it for a session. */
export async function signIn(credential: string): Promise<void> {
  const store = useAccount.getState();
  store.setPending(true);
  const answer = await signInWith(credential);
  store.setPending(false);
  if (!answer.ok) {
    store.openDialog({ kind: 'signin', message: answer.error });
    return;
  }
  store.setView(answer.data);
  trackAccount('signin');
  // Signed in from the dialog: it has done its job (the shopper presses Try It On again).
  if (useAccount.getState().dialog?.kind === 'signin') store.closeDialog();
}

export async function signOut(): Promise<void> {
  const store = useAccount.getState();
  store.setPending(true);
  const answer = await signOutNow();
  store.setPending(false);
  if (answer.ok) store.setView(answer.data);
  window.google?.accounts.id.disableAutoSelect();
}

/** "1 try-on", "5 try-ons". */
export function tryOns(n: number): string {
  return `${n} ${n === 1 ? 'try-on' : 'try-ons'}`;
}

/** "Your first 5 try-ons are free." (nothing when none are). */
export function freeLine(freeLooks: number): string {
  if (freeLooks <= 0) return '';
  return freeLooks === 1 ? 'Your first try-on is free.' : `Your first ${freeLooks} try-ons are free.`;
}

/** "You've used your 5 free try-ons" / "You've used your free try-on". */
export function usedUpLine(freeLooks: number): string {
  if (freeLooks <= 0) return 'Try-ons';
  return freeLooks === 1 ? "You've used your free try-on" : `You've used your ${freeLooks} free try-ons`;
}

/** "3 free try-ons left", "12 try-ons left", "Unlimited try-ons". */
export function leftText(user: AccountUser, freeLooks: number, short = false): string {
  if (user.left === null) return short ? 'Unlimited' : 'Unlimited try-ons';
  const n = user.left;
  if (user.credits > 0) return short ? `${n} left` : `${tryOns(n)} left`;
  if (short) return `${n} free left`;
  if (n === 0) return freeLooks === 1 ? 'Free try-on used' : `All ${freeLooks} free try-ons used`;
  return `${n} of ${freeLooks} free ${freeLooks === 1 ? 'try-on' : 'try-ons'} left`;
}
