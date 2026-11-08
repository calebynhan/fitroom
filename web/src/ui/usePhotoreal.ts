import { findColor, type Slot } from '../catalog/types';
import { usePhoto, type PhotoCaption } from '../state/photo';
import { useFit } from '../state/store';
import { getViewerCanvas } from '../viewer/canvasRef';
import { SCENES } from '../viewer/scenes';
import { snapshotPortrait } from './snapshot';

interface PhotorealResponse {
  image?: string;
  error?: string;
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
    return (await res.json()) as PhotorealResponse;
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' };
  }
}

/** Snapshots the viewer and asks /api/photoreal for a photograph. */
export async function makeItReal(): Promise<void> {
  const photo = usePhoto.getState();
  if (photo.photo.kind === 'working') return;
  const canvas = getViewerCanvas();
  if (!canvas) {
    photo.fail('The 3D view is not ready yet.', null);
    return;
  }
  const pieces = wornPieces();
  const caption = buildCaption(pieces);
  photo.start();
  const data = await post({
    image: snapshotPortrait(canvas),
    scene: useFit.getState().scene,
    outfit: [pieces.top, pieces.bottom].filter(Boolean),
  });
  const remaining = typeof data.remaining === 'number' ? data.remaining : null;
  if (data.image) usePhoto.getState().succeed(data.image, caption, remaining);
  else usePhoto.getState().fail(data.error ?? 'Something went wrong.', remaining);
}
