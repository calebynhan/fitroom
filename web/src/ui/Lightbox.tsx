import { useEffect, useRef } from 'react';
import { VIEW_LABEL, VIEWS, type View } from '@api/look';
import type { Look } from '../state/looks';
import { downloadName } from './download';

interface LightboxProps {
  look: Look;
  view: View;
  onClose: () => void;
  onNavigate: (view: View) => void;
}

/** One photo, large, with previous / next across the finished views. Esc closes; arrow keys move. */
export function Lightbox({ look, view, onClose, onNavigate }: LightboxProps) {
  const done = VIEWS.filter((v) => look.views[v].kind === 'done');
  const index = done.indexOf(view);
  const state = look.views[view];
  const closeRef = useRef<HTMLButtonElement>(null);

  const prev = done[(index - 1 + done.length) % done.length];
  const next = done[(index + 1) % done.length];

  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && next !== view) onNavigate(next);
      if (e.key === 'ArrowLeft' && prev !== view) onNavigate(prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, view, onClose, onNavigate]);

  if (state.kind !== 'done') return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${VIEW_LABEL[view]} photo`} onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={state.image} alt={`You, ${VIEW_LABEL[view].toLowerCase()} view`} />
        <div className="lightbox-bar">
          <span className="eyebrow">
            {VIEW_LABEL[view]} · {index + 1} / {done.length}
          </span>
          <div className="lightbox-actions">
            {done.length > 1 && (
              <>
                <button type="button" className="btn btn-outline" onClick={() => onNavigate(prev)} aria-label="Previous photo">
                  ←
                </button>
                <button type="button" className="btn btn-outline" onClick={() => onNavigate(next)} aria-label="Next photo">
                  →
                </button>
              </>
            )}
            <a className="btn btn-dark" href={state.image} download={downloadName(view)}>
              DOWNLOAD
            </a>
            <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
