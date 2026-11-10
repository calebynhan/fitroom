import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { VIEW_LABEL, type View } from '@api/look';
import type { Look } from '../state/looks';
import { downloadName } from './download';

interface LightboxProps {
  look: Look;
  view: View;
  onClose: () => void;
  onNavigate: (view: View) => void;
}

/** Keeps Tab / Shift+Tab cycling inside the open dialog. */
function trapFocus(e: KeyboardEvent): void {
  const dialog = document.querySelector('.lightbox');
  const items = Array.from(dialog?.querySelectorAll<HTMLElement>('button, a[href]') ?? []);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = dialog?.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/** One photo, large, with previous / next across the finished views. Esc closes; arrow keys move; Tab stays inside. */
export function Lightbox({ look, view, onClose, onNavigate }: LightboxProps) {
  const done = look.order.filter((v) => look.views[v].kind === 'done');
  const index = done.indexOf(view);
  const state = look.views[view];
  const closeRef = useRef<HTMLButtonElement>(null);

  const prev = done[(index - 1 + done.length) % done.length];
  const next = done[(index + 1) % done.length];

  // Modal for real: everything behind it is inert while it is open, and focus goes back where it came from.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    closeRef.current?.focus();
    return () => {
      root?.removeAttribute('inert');
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return trapFocus(e);
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && next !== view) onNavigate(next);
      if (e.key === 'ArrowLeft' && prev !== view) onNavigate(prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, view, onClose, onNavigate]);

  if (state.kind !== 'done') return null;
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${VIEW_LABEL[view]} photo`} onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={state.image} alt={`You, ${VIEW_LABEL[view].toLowerCase()} view`} width={1024} height={1536} />
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
            <a className="btn btn-dark" href={state.image} download={downloadName(view, state.image)}>
              Download
            </a>
            <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
