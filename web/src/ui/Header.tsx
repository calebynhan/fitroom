import { PHOTO_LIMIT_LABEL } from './constants';
import { usePhoto } from '../state/photo';
import { makeItReal } from './usePhotoreal';
import { useProgress } from './useProgress';

export function Header() {
  const photo = usePhoto((s) => s.photo);
  const remaining = usePhoto((s) => s.remaining);
  const plates = usePhoto((s) => s.plates);
  const progress = useProgress();
  const working = photo.kind === 'working';
  const showingResult = photo.kind === 'done';
  const outOfShots = remaining !== null && remaining <= 0;

  return (
    <header className="topbar">
      <div className="wordmark">FitRoom</div>
      {showingResult ? (
        <div className="eyebrow muted">
          PLATE {String(plates).padStart(2, '0')} OF {PHOTO_LIMIT_LABEL}
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-dark"
          onClick={() => void makeItReal()}
          disabled={working || outOfShots}
          title={outOfShots ? 'You have used all your photoreal shots' : 'Turn this view into a photograph'}
        >
          {working ? 'MAKING IT REAL…' : 'MAKE IT REAL'}
        </button>
      )}
      {progress !== null && (
        <div className="progress-line" aria-hidden>
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </header>
  );
}
