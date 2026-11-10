// Shoots a try-on look on the free Space: each of the shopper's photos (front, and side if given) gets the top, then
// the bottoms on that result. Photos are re-dressed, not regenerated, so the face and body stay the shopper's own.
// One pass at a time (the Space runs one job at a time anyway). A quota error stops the rest: retrying would only
// fail again until Hugging Face's allowance refills. Every run can be cancelled, and photos the shopper removed or
// replaced are never sent again: their cached inputs are dropped and a run still using them is stopped.
import type { View } from '@api/look';
import { findColor, productImage, type Slot } from '../catalog/types';
import type { LookCaption } from '../look/request';
import { exclusive } from '../look/shoot';
import { doneCount, useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { sharpenResult } from './composite';
import { loadGarmentPhoto, type GarmentPhoto } from './garment';
import { describeStatus, garmentUrl, PASS_MS, runSpace, SpaceError, within, type TryOnCategory, type TryOnRunner } from './space';

type AppSnapshot = Pick<ReturnType<typeof useApp.getState>, 'catalog' | 'outfit' | 'photos' | 'photoVersion'>;

export interface TryOnGarment {
  slot: Slot;
  name: string;
  category: TryOnCategory;
  /** Same-site URL of the UNIQLO product photo in the chosen colour. */
  image: string;
}

export type TryOnInput =
  | {
      ready: true;
      key: string;
      caption: LookCaption;
      order: View[];
      photos: Partial<Record<View, string>>;
      garments: TryOnGarment[];
      /** photoVersion of the photos inside: a newer version means they were removed or replaced. */
      version: number;
    }
  | { ready: false; missing: string[] };
type Ready = Extract<TryOnInput, { ready: true }>;

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
  return { ready: true, key, caption, order, photos, garments, version: state.photoVersion };
}

const inputs = new Map<string, Ready>();
const garmentPhotos = new Map<string, Promise<GarmentPhoto>>();
/** The run in progress, so the shopper (or a photo change) can stop it. */
let running: { controller: AbortController; version: number } | null = null;
const GARMENT_WAIT_MS = 20_000;

/** Stops the try-on in progress (the frame's Cancel). */
export function cancelTryOn(): void {
  running?.controller.abort();
}

// Photos removed or replaced: forget every input holding the old ones and stop a run that is still sending them.
useApp.subscribe((state, prev) => {
  if (state.photoVersion === prev.photoVersion) return;
  for (const [key, input] of inputs) if (input.version !== state.photoVersion) inputs.delete(key);
  if (running && running.version !== state.photoVersion) running.controller.abort();
});

/** True when a look's photos are still the ones on screen (Retry would send them again). */
export function canRetryTryOn(key: string): boolean {
  return inputs.get(key)?.version === useApp.getState().photoVersion;
}

/** The garment-only shot when UNIQLO has one, else the catalogue photo; cached per URL for the session. */
function garmentPhoto(url: string): Promise<GarmentPhoto> {
  let photo = garmentPhotos.get(url);
  if (!photo) {
    photo = loadGarmentPhoto(url).then(
      (p) => {
        if (!p) throw new SpaceError("UNIQLO doesn't have a photo of this item to try on.", false, false, url);
        return p;
      },
      (err: unknown) => {
        throw new SpaceError("Couldn't load the product photo. Check your connection and try again.", true, false, err instanceof Error ? err.message : null);
      },
    );
    photo.catch(() => garmentPhotos.delete(url));
    garmentPhotos.set(url, photo);
  }
  return photo;
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

interface Stop {
  quota: boolean;
  cancelled: boolean;
}

/** Re-dresses one photo with every garment in turn. Says whether to stop the remaining photos. */
async function shootView(key: string, view: View, input: Ready, run: TryOnRunner, signal: AbortSignal): Promise<Stop> {
  const looks = useLooks.getState();
  const previous = looks.looks[key]?.views[view];
  const startedAt = Date.now();
  const expectedMs = PASS_MS * input.garments.length;
  const working = (status: string) => looks.setView(key, view, { kind: 'working', startedAt, expectedMs, status });
  working('Sending your photo…');
  const photo = input.photos[view]!;
  let current: Blob | null = null;
  let worn: string[] = [];
  // The shopper's own photo above the new garment, the model's result below it (composite.ts).
  const finish = async (result: Blob) => sharpenResult(photo, result, await blobToDataUrl(result));
  try {
    current = await (await fetch(photo)).blob();
    for (const garment of input.garments) {
      const g = await within(garmentPhoto(garment.image), GARMENT_WAIT_MS, signal, () => new SpaceError("Couldn't load the product photo. Try again.", true));
      current = await run(current, g.blob, garment.category, g.type, (s) => working(describeStatus(s)), signal);
      worn = [...worn, garment.slot];
    }
    looks.setView(key, view, { kind: 'done', image: await finish(current) });
    return { quota: false, cancelled: false };
  } catch (err: unknown) {
    const e = asSpaceError(err);
    const stop = { quota: e.quota, cancelled: e.cancelled };
    if (signal.aborted && running?.version !== useApp.getState().photoVersion) {
      // stopped because the photos changed: show nothing made from the old ones
      looks.setView(key, view, { kind: 'error', message: 'Stopped: your photos changed.', detail: null, retryable: false });
      return stop;
    }
    if (worn.length > 0 && current) {
      const missingNames = input.garments.filter((g) => !worn.includes(g.slot)).map((g) => g.name.split(' in ')[0]);
      looks.setView(key, view, { kind: 'done', image: await finish(current), note: `Without the ${missingNames.join(' and ')}: ${e.message}` });
    } else if (previous?.kind === 'done') {
      // a retry that made nothing must not cost the photo already there
      looks.setView(key, view, { ...previous, note: `${e.message} Your earlier photo is kept.` });
    } else {
      looks.setView(key, view, { kind: 'error', message: e.message, detail: e.detail, retryable: e.retryable });
    }
    return stop;
  }
}

async function shootViews(key: string, views: View[], input: Ready, run: TryOnRunner): Promise<void> {
  const controller = new AbortController();
  running = { controller, version: input.version };
  try {
    for (const [i, view] of views.entries()) {
      const stop = await shootView(key, view, input, run, controller.signal);
      if (!stop.quota && !stop.cancelled && !controller.signal.aborted) continue;
      // Out of allowance or stopped: say so on the photos not tried yet instead of failing them one by one.
      const message = stop.quota
        ? "Not tried: Hugging Face's free GPU time for your connection is used up. It resets within a day."
        : 'Not tried: cancelled.';
      for (const rest of views.slice(i + 1)) {
        const before = useLooks.getState().looks[key]?.views[rest];
        if (before?.kind === 'done') continue;
        useLooks.getState().setView(key, rest, { kind: 'error', message, detail: null, retryable: input.version === useApp.getState().photoVersion });
      }
      return;
    }
  } finally {
    if (running?.controller === controller) running = null;
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

/** Tries one photo again, only while its photos are still the ones on screen. */
export function retryTryOnView(key: string, view: View, run: TryOnRunner = runSpace): Promise<void> {
  const input = inputs.get(key);
  if (!input || !canRetryTryOn(key)) return Promise.resolve();
  return exclusive(key, () => shootViews(key, [view], input, run));
}
