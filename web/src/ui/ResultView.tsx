import { usePhoto } from '../state/photo';
import { useLookKey } from '../state/store';

/** The photograph of the look on screen, laid over the 3D view once it is ready. */
export function ResultView() {
  const key = useLookKey();
  const photo = usePhoto((s) => s.shots[key]);
  const hidden = usePhoto((s) => s.hidden === key);
  const remaining = usePhoto((s) => s.remaining);
  const hide = usePhoto((s) => s.hide);
  if (!photo || hidden) return null;
  const { caption } = photo;

  return (
    <div className="result" role="dialog" aria-label="Photoreal result">
      <div className="result-frame">
        <div className="result-mat">
          <img src={photo.image} alt={`Photograph: ${caption.title.top ?? ''} ${caption.title.bottom ?? ''}`} />
        </div>
      </div>
      <div className="result-foot">
        <div className="result-caption">
          <div className="eyebrow muted">
            {caption.scene.toUpperCase()} · {caption.heightCm} CM · {caption.date.toUpperCase()}
            {remaining !== null && ` · ${remaining} SHOTS LEFT`}
          </div>
          <div className="result-title">
            {caption.title.top}
            {caption.title.top && caption.title.bottom && (
              <>
                , <em>with</em>{' '}
              </>
            )}
            {caption.title.bottom}
          </div>
        </div>
        <div className="result-actions">
          <button type="button" className="btn btn-outline" onClick={() => hide(key)}>
            BACK TO 3D
          </button>
          <a className="btn btn-dark" href={photo.image} download="fitroom.jpg">
            DOWNLOAD
          </a>
        </div>
      </div>
    </div>
  );
}
