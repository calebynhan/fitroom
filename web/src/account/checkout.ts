// Buying a pack of looks on Stripe's hosted page. Photos live only in this tab, so Checkout opens in a new tab: the
// shopper pays there, Stripe sends that tab back to FitRoom (?checkout=done&session_id=...), it confirms the payment
// and tells this tab over a BroadcastChannel; this tab also checks back when it regains focus and every few seconds
// while it waits. The webhook (api/stripe.ts) credits the pack even if nobody comes back.
import { trackAccount } from '../analytics';
import { confirmCheckoutSession, startCheckoutSession } from './api';
import { loadAccount, useAccount } from './store';

const CHANNEL = 'fitroom-account';
/** Set when Checkout had to open in this tab (pop-ups blocked): the photos are gone when Stripe sends it back. */
const SAME_TAB_KEY = 'fitroom.checkout.sameTab';

function sessionFlag(set?: boolean): boolean {
  try {
    if (set === true) window.sessionStorage.setItem(SAME_TAB_KEY, '1');
    const was = window.sessionStorage.getItem(SAME_TAB_KEY) === '1';
    if (set === false) window.sessionStorage.removeItem(SAME_TAB_KEY);
    return was;
  } catch {
    return false;
  }
}
const POLL_MS = 4000;
const POLL_FOR_MS = 15 * 60 * 1000;

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/** Opens Stripe Checkout in a new tab. Call it straight from the click (browsers only allow new tabs from one). */
export async function startCheckout(): Promise<void> {
  const store = useAccount.getState();
  // Opened now, inside the click; pointed at Stripe once the server has made the session.
  const tab = window.open('', '_blank');
  if (tab) {
    tab.opener = null;
    try {
      tab.document.title = 'FitRoom: opening checkout…';
      tab.document.body.textContent = 'Opening secure checkout…';
    } catch {
      // a blank tab we can't write to still works
    }
  }
  store.setPending(true);
  const answer = await startCheckoutSession();
  store.setPending(false);
  if (!answer.ok) {
    tab?.close();
    store.openDialog({ kind: 'buy', message: answer.error });
    return;
  }
  trackAccount('checkout');
  if (!tab) {
    // pop-ups blocked: pay in this tab (the leave warning tells the shopper their photos will go)
    sessionFlag(true);
    window.location.assign(answer.data.url);
    return;
  }
  tab.location.href = answer.data.url;
  store.openDialog({ kind: 'waiting' });
}

/** Paid looks before the purchase, to tell when the new ones arrive. */
function paidLooks(): number {
  return useAccount.getState().view?.user?.credits ?? 0;
}

/** While the dialog waits for a payment: listen for the return tab, check on focus, and poll. Returns a stop function. */
export function watchPurchase(): () => void {
  const before = paidLooks();
  const startedAt = Date.now();
  const bc = channel();
  const check = async () => {
    const view = await loadAccount();
    const now = view?.user?.credits ?? 0;
    if (now > before && useAccount.getState().dialog?.kind === 'waiting') {
      useAccount.getState().openDialog({ kind: 'thanks', added: now - before });
      trackAccount('paid');
    }
  };
  const onMessage = () => void check();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  bc?.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => {
    if (Date.now() - startedAt > POLL_FOR_MS) return window.clearInterval(timer);
    if (document.visibilityState === 'visible') void check();
  }, POLL_MS);
  return () => {
    bc?.removeEventListener('message', onMessage);
    bc?.close();
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}

/** On load: was this tab sent back by Stripe? Confirm the payment, tell the other tab, and say so. */
export async function handleCheckoutReturn(): Promise<void> {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('checkout');
  if (!result) return;
  const sessionId = url.searchParams.get('session_id');
  url.searchParams.delete('checkout');
  url.searchParams.delete('session_id');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

  const store = useAccount.getState();
  // Paid in this same tab (pop-ups were blocked): there is no other tab to go back to.
  const returnTab = !sessionFlag(false);
  if (result !== 'done' || !sessionId) {
    store.openDialog({ kind: 'cancelled', returnTab });
    return;
  }
  const answer = await confirmCheckoutSession(sessionId);
  if (answer.ok) {
    store.setView(answer.data.account);
    store.openDialog({ kind: 'thanks', added: answer.data.added, returnTab, photosLost: !returnTab });
    trackAccount('paid');
  } else {
    // The webhook still credits a payment that went through; this tab just couldn't confirm it.
    if (answer.account) store.setView(answer.account);
    store.openDialog({ kind: 'thanks', returnTab, photosLost: !returnTab, message: answer.error });
  }
  const bc = channel();
  bc?.postMessage('account');
  bc?.close();
}
