import { doneCount, useLooks } from '../state/looks';
import { useLookInput } from '../look/useLookInput';
import { makeLook } from '../look/shoot';
import { lookProgress, useNow } from './progress';

function ShootButton() {
  const input = useLookInput();
  const key = input.ready ? input.key : null;
  const look = useLooks((s) => (key ? s.looks[key] : undefined));
  const busy = useLooks((s) => s.busy);
  const remaining = useLooks((s) => s.remaining);
  const busyDone = useLooks((s) => (s.busy ? doneCount(s.looks[s.busy]) : 0));
  const outOfLooks = remaining !== null && remaining <= 0;

  let label = doneCount(look) > 0 ? 'SHOOT AGAIN' : 'MAKE MY SHOTS';
  let title = doneCount(look) > 0 ? 'Shoot this look again (uses one more look)' : 'Shoot this outfit on you from four angles';
  if (busy) {
    label = `DEVELOPING ${busyDone}/4`;
    title = 'Your photos are developing';
  } else if (!input.ready) {
    title = `Add your ${input.missing.join(', ')} first`;
  } else if (outOfLooks) {
    label = 'NO LOOKS LEFT';
    title = 'You have used all your looks';
  }

  return (
    <button
      type="button"
      className={`btn ${doneCount(look) > 0 && !busy ? 'btn-outline' : 'btn-dark'}`}
      onClick={() => {
        // On phones the photos sit above the form: bring them into view so the shoot is visible.
        if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
        void makeLook();
      }}
      disabled={Boolean(busy) || !input.ready || outOfLooks}
      title={title}
    >
      {label}
    </button>
  );
}

function ProgressLine() {
  const look = useLooks((s) => (s.busy ? s.looks[s.busy] : undefined));
  const now = useNow(Boolean(look));
  if (!look) return null;
  return (
    <div className="progress-line" aria-hidden>
      <div style={{ width: `${Math.round(lookProgress(look, now) * 100)}%` }} />
    </div>
  );
}

export function Header() {
  const remaining = useLooks((s) => s.remaining);
  return (
    <header className="topbar">
      <div className="wordmark">FitRoom</div>
      <div className="topbar-actions">
        {remaining !== null && (
          <span className="eyebrow muted">
            {remaining} {remaining === 1 ? 'LOOK' : 'LOOKS'} LEFT
          </span>
        )}
        <ShootButton />
      </div>
      <ProgressLine />
    </header>
  );
}
