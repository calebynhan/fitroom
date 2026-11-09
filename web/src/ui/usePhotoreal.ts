import { findColor, type Slot } from '../catalog/types';
import { usePhoto, type PhotoCaption } from '../state/photo';
import { currentLookKey, useFit } from '../state/store';
import { getViewerCanvas } from '../viewer/canvasRef';
import { SCENES } from '../viewer/scenes';
import { faceFront } from '../viewer/viewerBus';
import { snapshotPortrait } from './snapshot';

interface PhotorealResponse {
  image?: string;
  error?: string;
  detail?: string;
  retryable?: boolean;
  remaining?: number;
}

interface WornPiece {
  name: string;
  color: string;
  fabric: string;
}

function wornPieces(): Record<Slot, WornPiece | null> {
  const { outfit, catalog } = useFit.getState();
  const piece = (slot: Slot): WornPiece | null => {
    const sel = outfit[slot];
    const item = sel && catalog.find((i) => i.id === sel.itemId);
    return item && sel ? { name: item.name, color: findColor(item, sel.colorCode).name, fabric: item.fabric } : null;
  };
  return { top: piece('top'), bottom: piece('bottom') };
}

function buildCaption(pieces: Record<Slot, WornPiece | null>): PhotoCaption {
  const { scene, heightCm } = useFit.getState();
  const describe = (p: WornPiece | null) => (p ? `${p.name} in ${p.color}` : null);
  return {
    scene: SCENES[scene].label,
    heightCm,
    title: { top: describe(pieces.top), bottom: describe(pieces.bottom) },
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

async function post(body: object): Promise<PhotorealResponse> {
  try {
    const res = await fetch('/api/photoreal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 413) return { error: 'That snapshot was too large to send. Try a smaller window.', detail: 'HTTP 413' };
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      return { error: 'The server could not finish this photo. Try again in a moment.', detail: `HTTP ${res.status}`, retryable: true };
    }
    return (await res.json()) as PhotorealResponse;
  } catch (err: unknown) {
    console.error('[photoreal] request failed', err);
    return { error: 'Could not reach the server. Check your connection and try again.', retryable: true };
  }
}

let composing = false; // covers the camera turn before "working" is set

/**
 * Snapshots the viewer and asks /api/photoreal for a photograph of the current look.
 * Automatic shots turn the camera to the front first and fail quietly (auto then stops for the session).
 */
export async function makeItReal({ auto = false }: { auto?: boolean } = {}): Promise<void> {
  if (composing || usePhoto.getState().photo.kind === 'working') return;
  const canvas = getViewerCanvas();
  if (!canvas) {
    if (!auto) usePhoto.getState().fail({ message: 'The 3D view is not ready yet.' }, null, false);
    return;
  }
  composing = true;
  let image: string;
  let key: string;
  try {
    if (auto) await faceFront();
    key = currentLookKey(); // the look actually captured, even if it changed during the turn
    image = snapshotPortrait(canvas); // before start(), so a failure can't leave us stuck in "working"
  } catch (err: unknown) {
    console.error('[photoreal] snapshot failed', err);
    const detail = err instanceof Error ? err.message : null;
    usePhoto.getState().fail({ message: 'Could not capture the 3D view. Try again.', detail }, null, auto);
    return;
  } finally {
    composing = false;
  }
  const pieces = wornPieces();
  const caption = buildCaption(pieces);
  usePhoto.getState().start(key, auto);
  const data = await post({ image, scene: useFit.getState().scene, items: [pieces.top, pieces.bottom].filter(Boolean) });
  const remaining = typeof data.remaining === 'number' ? data.remaining : null;
  if (data.image) {
    usePhoto.getState().succeed(key, { image: data.image, caption }, remaining);
    return;
  }
  if (auto) console.warn('[photoreal] automatic shot failed; auto shots are off for this visit:', data.error, data.detail);
  const failure = { message: data.error ?? 'Something went wrong.', detail: data.detail ?? null, retryable: data.retryable ?? true };
  usePhoto.getState().fail(failure, remaining, auto);
}
