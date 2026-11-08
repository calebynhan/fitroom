import type { ReactElement } from 'react';
import { PHOTO_LIMIT_LABEL } from './constants';
import { usePhoto } from '../state/photo';
import { useLookKey } from '../state/store';
import { makeItReal } from './usePhotoreal';
import { useProgress } from './useProgress';

export function Header() {
  const key = useLookKey();
  const working = usePhoto((s) => s.photo.kind === 'working');
  const hasShot = usePhoto((s) => key in s.shots);
  const hidden = usePhoto((s) => s.hidden === key);
  const show = usePhoto((s) => s.show);
  const remaining = usePhoto((s) => s.remaining);
  const plates = usePhoto((s) => s.plates);
  const progress = useProgress();
  const outOfShots = remaining !== null && remaining <= 0;

  let action: ReactElement;
  if (hasShot && !hidden) {
    action = (
      <div className="eyebrow muted">
        PLATE {String(plates).padStart(2, '0')} OF {PHOTO_LIMIT_LABEL}
      </div>
    );
  } else if (hasShot) {
    action = (
      <button type="button" className="btn btn-dark" onClick={show}>
        VIEW PHOTO
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        className="btn btn-dark"
        onClick={() => void makeItReal()}
        disabled={working || outOfShots}
        title={outOfShots ? 'You have used all your photoreal shots' : 'Turn this view into a photograph now'}
      >
        {working ? 'MAKING IT REAL…' : 'MAKE IT REAL'}
      </button>
    );
  }

  return (
    <header className="topbar">
      <div className="wordmark">FitRoom</div>
      {action}
      {progress !== null && (
        <div className="progress-line" aria-hidden>
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </header>
  );
}
