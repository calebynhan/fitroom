// Shoots a try-on look on the free Space: each of the shopper's photos (front, and side if given) gets the top, then
// the bottoms on that result. Photos are re-dressed, not regenerated, so the face and body stay the shopper's own.
// One pass at a time (the Space runs one job at a time anyway). A quota error stops the rest: retrying would only
// fail again until Hugging Face's allowance refills.
import type { View } from '@api/look';
import { findColor, productImage, type Slot } from '../catalog/types';
import type { LookCaption } from '../look/request';
import { exclusive } from '../look/shoot';
import { doneCount, useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { describeStatus, fetchBlob, garmentUrl, PASS_MS, runSpace, SpaceError, type TryOnCategory, type TryOnRunner } from './space';

type AppSnapshot = Pick<ReturnType<typeof useApp.getState>, 'catalog' | 'outfit' | 'photos' | 'photoVersion'>;

export interface TryOnGarment {
  slot: Slot;
  name: string;
  category: TryOnCategory;
  /** Same-site URL of the UNIQLO product photo in the chosen colour. */
  image: string;
}

export type TryOnInput =
  | { ready: true; key: string; caption: LookCaption; order: View[]; photos: Partial<Record<View, string>>; garments: TryOnGarment[] }
  | { ready: false; missing: string[] };

/** What a try-on look needs: a front photo and something to wear. Measurements size it, but the photo doesn't need them. */
export function tryOnInput(state: AppSnapshot): TryOnInput {
  const garments: TryOnGarment[] = [];
  for (const slot of ['top', 'bottom'] as const) {
    const selection = state.outfit[slot];
    const item = selection && state.catalog.find((i) => i.id === selection.itemId);
    const image = item && selection ? productImage(item, selection.colorCode) : undefined;
    if (!item || !selection || !image) continue;
    garments.push({
      slot,
      name: `${item.name} in ${findColor(item, selection.colorCode).name}`,
      category: slot === 'top' ? 'tops' : 'bottoms',
      image: garmentUrl(image),
    });
  }
  const missing: string[] = [];
  if (!state.photos.front) missing.push('front photo');
  if (garments.length === 0) missing.push('something to wear');
  if (missing.length || !state.photos.front) return { ready: false, missing };

  const photos: Partial<Record<View, string>> = { front: state.photos.front.dataUrl };
  if (state.photos.side) photos.side = state.photos.side.dataUrl;
  const order = Object.keys(photos) as View[];
  const caption: LookCaption = {
    top: garments.find((g) => g.slot === 'top')?.name ?? null,
    bottom: garments.find((g) => g.slot === 'bottom')?.name ?? null,
    meta: 'Free try-on · your own photo',
  };
  // The photo does not depend on the size (the model draws the garment as photographed), so sizes aren't in the key.
  const key = JSON.stringify({ engine: 'space', v: state.photoVersion, order, garments: garments.map((g) => [g.slot, g.image]) });
  return { ready: true, key, caption, order, photos, garments };
}

const inputs = new Map<string, Extract<TryOnInput, { ready: true }>>();
const garmentBlobs = new Map<string, Promise<Blob>>();

function garmentBlob(url: string): Promise<Blob> {
  let blob = garmentBlobs.get(url);
  if (!blob) {
    blob = fetchBlob(url).catch((err: unknown) => {
      garmentBlobs.delete(url);
      throw err;
    });
    garmentBlobs.set(url, blob);
  }
  return blob;
}

/** Data URL of a result image (kept in memory like every photo; also what the Download link saves). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`;
}

function asSpaceError(err: unknown): SpaceError {
  if (err instanceof SpaceError) return err;
  console.error('[tryon] unexpected failure', err);
  return new SpaceError('Something went wrong with the try-on. Try again.', true, false, err instanceof Error ? err.message : null);
}

/** Re-dresses one photo with every garment in turn. Returns true if Hugging Face's allowance ran out. */
async function shootView(key: string, view: View, input: Extract<TryOnInput, { ready: true }>, run: TryOnRunner): Promise<boolean> {
  const looks = useLooks.getState();
  const startedAt = Date.now();
  const expectedMs = PASS_MS * input.garments.length;
  const working = (status: string) => looks.setView(key, view, { kind: 'working', startedAt, expectedMs, status });
  working('Sending your photo…');
  let current: Blob | null = null;
  let image: string | null = null;
  let worn: string[] = [];
  try {
    current = await (await fetch(input.photos[view]!)).blob();
    for (const garment of input.garments) {
      const garmentImage = await garmentBlob(garment.image);
      current = await run(current, garmentImage, garment.category, (s) => working(describeStatus(s)));
      image = await blobToDataUrl(current);
      worn = [...worn, garment.slot];
    }
    looks.setView(key, view, { kind: 'done', image: image! });
    return false;
  } catch (err: unknown) {
    const e = asSpaceError(err);
    if (image) {
      const missingNames = input.garments.filter((g) => !worn.includes(g.slot)).map((g) => g.name.split(' in ')[0]);
      looks.setView(key, view, { kind: 'done', image, note: `Without the ${missingNames.join(' and ')}: ${e.message}` });
    } else {
      looks.setView(key, view, { kind: 'error', message: e.message, detail: e.detail, retryable: e.retryable });
    }
    return e.quota;
  }
}

async function shootViews(key: string, views: View[], input: Extract<TryOnInput, { ready: true }>, run: TryOnRunner): Promise<void> {
  for (const [i, view] of views.entries()) {
    const quota = await shootView(key, view, input, run);
    if (!quota) continue;
    // The allowance is gone: say so on the photos not tried yet instead of failing them one by one.
    for (const rest of views.slice(i + 1)) {
      const e = new SpaceError(
        "Not tried: Hugging Face's free GPU time for your connection is used up for now. Try again later.",
        true,
        true,
      );
      useLooks.getState().setView(key, rest, { kind: 'error', message: e.message, detail: null, retryable: true });
    }
    return;
  }
}

/** Re-dresses every photo for the outfit on screen (starting over if it was shot before). */
export function makeTryOnLook(run: TryOnRunner = runSpace): Promise<void> {
  const input = tryOnInput(useApp.getState());
  if (!input.ready) return Promise.resolve();
  const { key } = input;
  return exclusive(key, async () => {
    const previous = useLooks.getState().looks[key];
    inputs.set(key, input);
    useLooks.getState().start(key, input.caption, input.order);
    await shootViews(key, input.order, input, run);
    // A reshoot that produced nothing: keep the earlier photos rather than a failed, empty look.
    const look = useLooks.getState().looks[key];
    if (previous && doneCount(previous) > 0 && doneCount(look) === 0) {
      const failed = look?.views[input.order[0]];
      const reason = failed?.kind === 'error' ? failed.message : 'The new try-on failed.';
      useLooks.getState().restore(previous, `Couldn't redo this try-on: ${reason} Your earlier photos are kept.`);
    }
  });
}

/** Tries one photo again. */
export function retryTryOnView(key: string, view: View, run: TryOnRunner = runSpace): Promise<void> {
  const input = inputs.get(key);
  if (!input) return makeTryOnLook(run);
  return exclusive(key, () => shootViews(key, [view], input, run));
}
