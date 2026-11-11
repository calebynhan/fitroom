// The rail's account section: sign in, try-ons left, buy more, sign out. Hidden while try-ons are free for everyone.
import { leftText, signOut, useAccount } from '../account/store';
import { TRY_ON } from '../look/engine';
import { GPU_CAVEAT, lookRule } from './AccountDialog';
import { GoogleButton } from './GoogleButton';

export function AccountSection() {
  const view = useAccount((s) => s.view);
  const pending = useAccount((s) => s.pending);
  const openDialog = useAccount((s) => s.openDialog);
  if (!view?.billing) return null;
  const user = view.user;
  return (
    <section className="rail-section account" id="account" aria-labelledby="account-title">
      <h2 className="eyebrow" id="account-title">
        Your account
      </h2>
      {user ? (
        <>
          <p className="account-left">{leftText(user, view.freeLooks)}</p>
          {!user.exempt && <p className="note">{lookRule(view.freeLooks)}</p>}
          {!user.exempt && view.pack && (
            <div className="account-buy">
              <button type="button" className="btn btn-outline" disabled={pending} onClick={() => openDialog({ kind: 'buy' })}>
                Buy {view.pack.looks} · {view.pack.price}
              </button>
              {TRY_ON && <p className="note fine">{GPU_CAVEAT}</p>}
            </div>
          )}
          <p className="note account-who">
            Signed in as <span translate="no">{user.email}</span> ·{' '}
            <button type="button" className="link-btn" disabled={pending} onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="note">{lookRule(view.freeLooks)} Sign in with Google so FitRoom can count them; it keeps your email and the count, never your photos.</p>
          {view.googleClientId && <GoogleButton clientId={view.googleClientId} />}
        </>
      )}
    </section>
  );
}
