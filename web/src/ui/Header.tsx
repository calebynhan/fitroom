import { leftText, useAccount } from '../account/store';
import { doneCount, useLooks } from '../state/looks';
import { makeShots, TRY_ON, useShotInput } from '../look/engine';
import { lookProgress, useNow } from './progress';

/** Where each missing part is filled in, so the button can take the shopper there. */
const MISSING_TARGET: Record<string, { section: string; focus?: string }> = {
  'front photo': { section: 'you', focus: '.photo-drop' },
  'side photo': { section: 'you', focus: '.photo-tile:nth-child(2) .photo-drop' },
  'face profile': { section: 'you', focus: '.photo-tile:nth-child(3) .photo-drop' },
  'height and weight': { section: 'measure', focus: 'input' },
  'something to wear': { section: 'outfit', focus: 'input' },
};

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function revealMissing(missing: string): void {
  const target = MISSING_TARGET[missing];
  const section = target && document.getElementById(target.section);
  if (!section) return;
  section.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  section.querySelector<HTMLElement>(target.focus ?? 'button, input')?.focus({ preventScroll: true });
}

function ShootButton() {
  const input = useShotInput();
  const key = input.ready ? input.key : null;
  const look = useLooks((s) => (key ? s.looks[key] : undefined));
  const busy = useLooks((s) => s.busy);
  const remaining = useLooks((s) => s.remaining);
  const busyDone = useLooks((s) => (s.busy ? doneCount(s.looks[s.busy]) : 0));
  const busyTotal = useLooks((s) => (s.busy ? (s.looks[s.busy]?.order.length ?? 0) : 0));
  const paid = useAccount((s) => s.view?.billing === true);
  // The visitor cookie limit (paid generator) only applies while paid try-ons are off.
  const outOfLooks = !paid && remaining !== null && remaining <= 0;

  const again = doneCount(look) > 0;
  let label = TRY_ON ? (again ? 'Try On Again' : 'Try It On') : again ? 'Shoot Again' : 'Make My Shots';
  // all done while busy: a size comparison is developing
  if (busy) label = busyTotal > 1 && busyDone < busyTotal ? `Developing… ${busyDone}/${busyTotal}` : 'Developing…';
  else if (outOfLooks) label = 'No Looks Left';

  const onClick = () => {
    // Not ready: take the shopper to the first thing missing instead of a silent disabled button.
    if (!input.ready) return revealMissing(input.missing[0]);
    // On phones the photos sit above the form: bring them into view so the shoot is visible.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: scrollBehavior() });
    void makeShots();
  };

  return (
    <>
      <button
        type="button"
        className={`btn ${again && !busy ? 'btn-outline' : 'btn-dark'}`}
        onClick={onClick}
        disabled={Boolean(busy) || outOfLooks}
        aria-describedby={input.ready ? undefined : 'shoot-missing'}
      >
        {label}
      </button>
      {!input.ready && (
        <span className="sr-only" id="shoot-missing">
          First add your {input.missing.join(', ')}.
        </span>
      )}
    </>
  );
}

function ProgressLine() {
  const look = useLooks((s) => (s.busy ? s.looks[s.busy] : undefined));
  const now = useNow(Boolean(look));
  if (!look) return null;
  return (
    <div className="progress-line" aria-hidden>
      <div style={{ transform: `scaleX(${lookProgress(look, now).toFixed(3)})` }} />
    </div>
  );
}

/** Try-ons left (paid try-ons on), or "Sign in"; either one opens the rail's account section. */
function AccountChip() {
  const view = useAccount((s) => s.view);
  if (!view?.billing) return null;
  const user = view.user;
  if (user?.exempt) return null;
  return (
    <a className="link-btn account-chip" href="#account">
      {user ? leftText(user, view.freeLooks, true) : 'Sign in'}
    </a>
  );
}

export function Header() {
  const remaining = useLooks((s) => s.remaining);
  const paid = useAccount((s) => s.view?.billing === true);
  return (
    <header className="topbar">
      <div className="wordmark" translate="no">
        FitRoom
      </div>
      <div className="topbar-actions">
        <a className="link-btn about-link" href="#about">
          How it works
        </a>
        <AccountChip />
        {!TRY_ON && !paid && remaining !== null && (
          <span className="eyebrow muted looks-left">
            {remaining} {remaining === 1 ? 'look' : 'looks'} left
          </span>
        )}
        <ShootButton />
      </div>
      <ProgressLine />
    </header>
  );
}
