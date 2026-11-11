// The free GPU allowance, in the shopper's terms: what the next try-on costs and roughly what is left today. With paid
// try-ons on, also what it costs in the shopper's looks.
import { freeLine, useAccount } from '../account/store';
import { useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { allowanceText, useAllowance } from '../tryon/allowance';
import { addSideView, canAddSide, passesNeeded, sidePasses, tryOnInput } from '../tryon/shoot';

/** What the try-on of the outfit on screen would cost. Hidden when there is nothing to try on. */
export function AllowanceNote({ className = 'note' }: { className?: string }) {
  const allowance = useAllowance((s) => s.allowance);
  useLooks((s) => s.looks); // finished passes change the cost
  const catalog = useApp((s) => s.catalog);
  const outfit = useApp((s) => s.outfit);
  const photos = useApp((s) => s.photos);
  const photoVersion = useApp((s) => s.photoVersion);
  const input = tryOnInput({ catalog, outfit, photos, photoVersion });
  if (!input.ready) return null;
  const note = allowanceText(allowance, passesNeeded(input), Date.now());
  if (!note) return null;
  return <p className={`${className} allowance ${note.warn ? 'warn' : ''}`}>{note.text}</p>;
}

/** "Try your side photo too": the side photo is shot only on request, so a front costs half as much. */
export function AddSideButton({ lookKey }: { lookKey: string }) {
  const busy = useLooks((s) => s.busy);
  const look = useLooks((s) => s.looks[lookKey]);
  const allowance = useAllowance((s) => s.allowance);
  if (!look || look.views.front.kind !== 'done' || !canAddSide(lookKey)) return null;
  const need = sidePasses(lookKey);
  const note = allowanceText(allowance, need, Date.now());
  return (
    <div className="add-side">
      <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void addSideView(lookKey)}>
        Try Your Side Photo Too
      </button>
      {note && <p className={`note allowance ${note.warn ? 'warn' : ''}`}>{note.text}</p>}
    </div>
  );
}

/** Paid try-ons: whether the try-on on screen uses one of the shopper's looks. Hidden when billing is off. */
export function CreditNote() {
  const view = useAccount((s) => s.view);
  useLooks((s) => s.looks); // finished passes change the cost
  const catalog = useApp((s) => s.catalog);
  const outfit = useApp((s) => s.outfit);
  const photos = useApp((s) => s.photos);
  const photoVersion = useApp((s) => s.photoVersion);
  const input = tryOnInput({ catalog, outfit, photos, photoVersion });
  const user = view?.user;
  if (!view?.billing || !input.ready || passesNeeded(input) === 0) return null;
  if (!user) return <p className="note">Sign in to try it on. {freeLine(view.freeLooks)}</p>;
  if (user.left === null) return null;
  if (user.left === 0) return <p className="note allowance warn">No try-ons left: trying this one on asks you to buy more.</p>;
  const kind = user.credits > 0 ? '' : 'free ';
  if (user.left === 1) return <p className="note">Uses your last {kind}try-on.</p>;
  return (
    <p className="note">
      Uses 1 of your {user.left} {kind}try-ons.
    </p>
  );
}
