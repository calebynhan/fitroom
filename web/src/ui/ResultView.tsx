import { usePhoto } from '../state/photo';

export function ResultView() {
  const photo = usePhoto((s) => s.photo);
  const remaining = usePhoto((s) => s.remaining);
  const dismiss = usePhoto((s) => s.dismiss);
  if (photo.kind !== 'done') return null;
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
          <button type="button" className="btn btn-outline" onClick={dismiss}>
            BACK TO TRY-ON
          </button>
          <a className="btn btn-dark" href={photo.image} download="fitroom.jpg">
            DOWNLOAD
          </a>
        </div>
      </div>
    </div>
  );
}
