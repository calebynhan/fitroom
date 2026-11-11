// The free GPU allowance, in the shopper's terms: what the next try-on costs and roughly what is left today.
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
