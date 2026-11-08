import { useState } from 'react';
import { findColor } from '../catalog/types';
import { useFit } from '../state/store';
import { getViewerCanvas } from '../viewer/canvasRef';
import { snapshotPortrait } from './snapshot';

type Shot =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; image: string; remaining: number | null }
  | { kind: 'error'; message: string };

interface PhotorealResponse {
  image?: string;
  error?: string;
  remaining?: number;
}

function useOutfitDescription() {
  const outfit = useFit((s) => s.outfit);
  const catalog = useFit((s) => s.catalog);
  return (['top', 'bottom'] as const).flatMap((slot) => {
    const sel = outfit[slot];
    const item = sel && catalog.find((i) => i.id === sel.itemId);
    return item && sel ? [{ name: item.name, color: findColor(item, sel.colorCode).name, fabric: item.fabric }] : [];
  });
}

async function requestPhotoreal(body: object): Promise<PhotorealResponse> {
  try {
    const res = await fetch('/api/photoreal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as PhotorealResponse;
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' };
  }
}

export function MakeItReal() {
  const scene = useFit((s) => s.scene);
  const outfit = useOutfitDescription();
  const [shot, setShot] = useState<Shot>({ kind: 'idle' });
  const [remaining, setRemaining] = useState<number | null>(null);

  const run = async () => {
    const canvas = getViewerCanvas();
    if (!canvas) return setShot({ kind: 'error', message: 'The 3D view is not ready yet.' });
    setShot({ kind: 'working' });
    const data = await requestPhotoreal({ image: snapshotPortrait(canvas), scene, outfit });
    if (typeof data.remaining === 'number') setRemaining(data.remaining);
    if (data.image) setShot({ kind: 'done', image: data.image, remaining: data.remaining ?? null });
    else setShot({ kind: 'error', message: data.error ?? 'Something went wrong.' });
  };

  const close = () => setShot({ kind: 'idle' });
  const outOfShots = remaining !== null && remaining <= 0;

  return (
    <>
      <button type="button" className="cta" onClick={run} disabled={shot.kind === 'working' || outOfShots}>
        {shot.kind === 'working' ? 'Developing…' : '✨ Make it real'}
      </button>
      {shot.kind !== 'idle' && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Photoreal shot" onClick={close}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            {shot.kind === 'working' && (
              <div className="developing">
                <div className="spinner" aria-hidden />
                <p>Developing your photo… about 30 seconds.</p>
              </div>
            )}
            {shot.kind === 'done' && (
              <>
                <img className="photo" src={shot.image} alt="Photorealistic render of the current outfit" />
                <div className="modal-actions">
                  <a className="pill active" href={shot.image} download="fitroom.jpg">
                    Download
                  </a>
                  {shot.remaining !== null && <span className="hint">{shot.remaining} shots left</span>}
                  <button type="button" className="pill" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
            {shot.kind === 'error' && (
              <>
                <p className="error">{shot.message}</p>
                <div className="modal-actions">
                  <button type="button" className="pill" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
