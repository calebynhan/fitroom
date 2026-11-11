// The account dialog: sign in before the first try-on, buy more after the free ones, wait for a payment in the other
// tab, thanks. Opened by the gate (account/gate.ts), the rail's account section and Stripe's return link.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { startCheckout, watchPurchase } from '../account/checkout';
import { freeLine, leftText, loadAccount, tryOns, usedUpLine, useAccount, type AccountDialog as Dialog } from '../account/store';
import { TRY_ON } from '../look/engine';
import { GoogleButton } from './GoogleButton';

const FOCUSABLE = 'button:not(:disabled), a[href], iframe';

/** Keeps Tab / Shift+Tab inside the dialog (Google's button is an iframe, so it counts). */
function trapFocus(e: KeyboardEvent, dialog: HTMLElement | null): void {
  const items = Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = dialog?.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/** What a try-on is, in one line (both dialogs and the rail say the same). */
export function lookRule(freeLooks: number): string {
  return `${freeLine(freeLooks)} A try-on is a new outfit on your photo, or the same outfit with one piece changed; trying the same outfit again, or on your side photo, is free.`.trim();
}

/** Paying doesn't buy GPU time: the free try-on still runs on Hugging Face's daily allowance. */
export const GPU_CAVEAT = "Each try-on still runs on Hugging Face's free GPUs, which allow a few a day per connection.";

function Body({ dialog }: { dialog: Dialog }) {
  const view = useAccount((s) => s.view);
  const pending = useAccount((s) => s.pending);
  const close = useAccount((s) => s.closeDialog);
  const user = view?.user ?? null;
  const freeLooks = view?.freeLooks ?? 0;
  // Asked to buy while signed out (e.g. signed out in another tab): sign in first.
  const kind = dialog.kind === 'buy' && !user ? 'signin' : dialog.kind;

  switch (kind) {
    case 'signin':
      return (
        <>
          <h2 className="dialog-title" id="account-dialog-title">
            Sign in to try it on
          </h2>
          <p className="dialog-copy">{lookRule(freeLooks)}</p>
          {view?.googleClientId ? <GoogleButton clientId={view.googleClientId} /> : <p className="note warn">Sign-in isn't available right now. Reload the page.</p>}
          <p className="note">FitRoom keeps your email and how many try-ons you've used; never your photos.</p>
        </>
      );
    case 'buy':
      return (
        <>
          <h2 className="dialog-title" id="account-dialog-title">
            {user && user.freeUsed >= freeLooks && user.credits === 0 ? usedUpLine(freeLooks) : 'More try-ons'}
          </h2>
          {view?.pack ? (
            <>
              <p className="dialog-copy">
                Get {view.pack.looks} more for {view.pack.price}, paid once on Stripe's secure page. It opens in a new tab, so your
                photos stay here.
              </p>
              <button type="button" className="btn btn-dark dialog-cta" disabled={pending} onClick={() => void startCheckout()}>
                {pending ? 'Opening checkout…' : `Buy ${view.pack.looks} Try-Ons · ${view.pack.price}`}
              </button>
            </>
          ) : (
            <p className="dialog-copy">Buying more try-ons isn't open yet. Check back soon.</p>
          )}
          {TRY_ON && <p className="note">{GPU_CAVEAT}</p>}
        </>
      );
    case 'waiting':
      return (
        <>
          <h2 className="dialog-title" id="account-dialog-title">
            Finish paying in the new tab
          </h2>
          <p className="dialog-copy">Your try-ons show up here as soon as Stripe confirms the payment. Your photos are still in this tab.</p>
          <button type="button" className="btn btn-outline dialog-cta" onClick={() => void loadAccount()}>
            I've Paid: Check Again
          </button>
        </>
      );
    case 'thanks':
      return (
        <>
          <h2 className="dialog-title" id="account-dialog-title">
            Thank you
          </h2>
          <p className="dialog-copy">
            {dialog.added ? `${tryOns(dialog.added)} added. ` : ''}
            {user ? `${leftText(user, freeLooks)}.` : ''}
            {dialog.returnTab ? ' You can close this tab and go back to FitRoom: your photos are in the other tab.' : ' Press Try It On to carry on.'}
          </p>
          <button type="button" className="btn btn-dark dialog-cta" onClick={close}>
            {dialog.returnTab ? 'Done' : 'Carry On'}
          </button>
        </>
      );
    case 'cancelled':
      return (
        <>
          <h2 className="dialog-title" id="account-dialog-title">
            Payment cancelled
          </h2>
          <p className="dialog-copy">Nothing was charged.{dialog.returnTab ? ' You can close this tab and go back to FitRoom.' : ''}</p>
        </>
      );
    default:
      return (
        <h2 className="dialog-title" id="account-dialog-title">
          Something went wrong
        </h2>
      );
  }
}

export function AccountDialog() {
  const dialog = useAccount((s) => s.dialog);
  const close = useAccount((s) => s.closeDialog);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = dialog !== null;
  const waiting = dialog?.kind === 'waiting';

  // Modal for real: the page behind is inert, focus starts inside and goes back where it came from.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') trapFocus(e, ref.current);
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      if (opener?.isConnected) opener.focus();
    };
  }, [open, close]);

  useEffect(() => (waiting ? watchPurchase() : undefined), [waiting]);

  if (!dialog) return null;
  return createPortal(
    <div className="dialog-backdrop" onClick={close}>
      <div
        ref={ref}
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <span className="eyebrow muted">Your try-ons</span>
          <button ref={closeRef} type="button" className="link-btn" onClick={close}>
            Close
          </button>
        </div>
        <Body dialog={dialog} />
        {dialog.message && (
          <p className="note warn" role="alert">
            {dialog.message}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
