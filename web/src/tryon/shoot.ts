// Shoots a try-on look on the free Space: the shopper's front photo gets the top, then the bottoms on that result (the
// side photo only when they ask for it). Photos are re-dressed, not regenerated, so the face and body stay their own.
// One pass at a time (the Space runs one job at a time anyway). A quota error stops the rest: retrying would only
// fail again until Hugging Face's allowance refills. Every run can be cancelled, and photos the shopper removed or
// replaced are never sent again: their cached inputs are dropped and a run still using them is stopped.
// Free GPU time is scarce (about 3 passes a day), so every finished pass is kept in memory: the same photo in the same
// top is reused when only the bottoms change, and a retry after a partial photo starts from the part that worked.
// Each pass is shown only the part of the photo it dresses (frame.ts) and goes back into the full-resolution photo
// (composite.ts); the next pass starts from that, so the bottoms pass never redraws the top from a small, lossy copy.
// Paid try-ons (account/gate.ts): a look that needs GPU passes is charged first and given back if it makes no photo.
import type { View } from '@api/look';
import { admit, billingOff, lookId, release, type Ticket } from '../account/gate';
import { outcomeOf, trackTryOn } from '../analytics';
import { recordPass, recordQuota } from './allowance';
import { colorLabel, productImage, type Slot } from '../catalog/types';
import type { LookCaption } from '../look/request';
import { exclusive } from '../look/shoot';
import { doneCount, useLooks, type Look } from '../state/looks';
import { useApp } from '../state/store';
import { bodyOf, keepBodies, prefetchBody, type Body } from '../photos/body';
import { skinColouredHex } from './composite';
import { loadGarmentPhoto, type GarmentPhoto } from './garment';
import { dressPass } from './pass';
import { describeStatus, garmentUrl, PASS_MS, runSpace, SpaceError, warmUp, within, type TryOnCategory, type TryOnRunner } from './space';

type AppSnapshot = Pick<ReturnType<typeof useApp.getState>, 'catalog' | 'outfit' | 'photos' | 'photoVersion'>;

export interface TryOnGarment {
  slot: Slot;
  name: string;
  category: TryOnCategory;
  /** Same-site URL of the UNIQLO product photo in the chosen colour. */
  image: string;
  /** The colour reads as skin (beige, tan, pink...): the compositor then doesn't keep the shopper's skin. */
  skinTone?: boolean;
}

export type TryOnInput =
  | {
      ready: true;
      key: string;
      caption: LookCaption;
      /** The views a new look shoots: the front. The side photo, if given, is shot on request (addSideView). */
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
      name: `${item.name} in ${colorLabel(item, selection.colorCode)}`,
      category: slot === 'top' ? 'tops' : 'bottoms',
      image: garmentUrl(image),
      skinTone: skinColouredHex(item.colors.find((c) => c.code === selection.colorCode)?.hex),
    });
  }
  const missing: string[] = [];
  if (!state.photos.front) missing.push('front photo');
  if (garments.length === 0) missing.push('something to wear');
  if (missing.length || !state.photos.front) return { ready: false, missing };

  const photos: Partial<Record<View, string>> = { front: state.photos.front.dataUrl };
  if (state.photos.side) photos.side = state.photos.side.dataUrl;
  const order: View[] = ['front'];
  const caption: LookCaption = {
    top: garments.find((g) => g.slot === 'top')?.name ?? null,
    bottom: garments.find((g) => g.slot === 'bottom')?.name ?? null,
    meta: 'Free try-on · your own photo',
  };
  // The photo does not depend on the size (the model draws the garment as photographed), so sizes aren't in the key.
  const key = JSON.stringify({ engine: 'space', v: state.photoVersion, garments: garments.map((g) => [g.slot, g.image]) });
  return { ready: true, key, caption, order, photos, garments, version: state.photoVersion };
}

const inputs = new Map<string, Ready>();
/** Finished passes: photo version + view + the garments worn so far, in order -> the photo wearing them (data URL). */
const passes = new Map<string, string>();
const MAX_PASSES = 16;
const passKey = (version: number, view: View, garments: TryOnGarment[]) => [version, view, ...garments.map((g) => g.image)].join('|');

function keepPass(key: string, image: string): void {
  passes.delete(key);
  passes.set(key, image);
  while (passes.size > MAX_PASSES) passes.delete(passes.keys().next().value!);
}

/** How many of `garments` are already on `view` from an earlier pass (the longest finished prefix). */
function reusable(input: Ready, view: View): number {
  for (let n = input.garments.length; n > 0; n -= 1) if (passes.has(passKey(input.version, view, input.garments.slice(0, n)))) return n;
  return 0;
}

/** Forgets every finished pass (tests). */
export function forgetPasses(): void {
  passes.clear();
}

/** GPU passes a try-on of `views` still needs (garments not already on each photo). */
export function passesNeeded(input: Ready, views: View[] = input.order): number {
  return views.reduce((sum, view) => sum + input.garments.length - reusable(input, view), 0);
}
const garmentPhotos = new Map<string, Promise<GarmentPhoto>>();

/** How long a try-on waits for the body landmarks (a first visit downloads the model) before sending the whole photo. */
const BODY_WAIT_MS = 15_000;
let findBody: (photo: string) => Promise<Body | null> = bodyOf;
/** Replaces the landmark finder (tests: Node has no canvas or WASM model). */
export function setBodyFinder(find: (photo: string) => Promise<Body | null>): void {
  findBody = find;
}

/** The body in `photo`, or null when it isn't found in time (never rejects: the whole photo is the fallback). */
function bodyFor(photo: string): Promise<Body | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), BODY_WAIT_MS);
    findBody(photo).then(
      (body) => {
        clearTimeout(timer);
        resolve(body);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

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
  // a front photo means a try-on is coming: open the connection now (config only, no photo is sent), saving seconds later
  const freeEngine = import.meta.env.VITE_PHOTO_ENGINE !== 'openai';
  const browser = typeof window !== 'undefined' && !import.meta.env.VITEST;
  if (freeEngine && state.photos.front && !prev.photos.front && browser) void warmUp();
  // and find the body in it meanwhile (on the device), so the try-on can send just the part being dressed
  if (freeEngine && browser) {
    keepBodies([state.photos.front?.dataUrl, state.photos.side?.dataUrl].filter((p): p is string => Boolean(p)));
    if (state.photos.front && state.photos.front.dataUrl !== prev.photos.front?.dataUrl) prefetchBody(state.photos.front.dataUrl);
  }
  for (const [key, input] of inputs) if (input.version !== state.photoVersion) inputs.delete(key);
  for (const key of passes.keys()) if (!key.startsWith(`${state.photoVersion}|`)) passes.delete(key);
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

/** Cancelling stops the run; any other failure to get the landmarks just means sending the whole photo. */
function rethrowCancel(err: unknown): null {
  if (err instanceof SpaceError && err.cancelled) throw err;
  return null;
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
  const reused = reusable(input, view);
  const expectedMs = PASS_MS * Math.max(1, input.garments.length - reused);
  const working = (status: string) => looks.setView(key, view, { kind: 'working', startedAt, expectedMs, status });
  working(reused ? 'Picking up where you left off…' : 'Sending your photo…');
  const photo = input.photos[view]!;
  // the photo wearing the garments so far, at its own resolution: what the next pass starts from
  let base = reused ? passes.get(passKey(input.version, view, input.garments.slice(0, reused)))! : photo;
  let worn: string[] = input.garments.slice(0, reused).map((g) => g.slot);
  const body = bodyFor(photo); // on the device, while the garment photo loads
  try {
    for (const [i, garment] of input.garments.entries()) {
      if (i < reused) continue;
      const g = await within(garmentPhoto(garment.image), GARMENT_WAIT_MS, signal, () => new SpaceError("Couldn't load the product photo. Try again.", true));
      const landmarks = await within(body, BODY_WAIT_MS + 1000, signal, () => new Error('no body')).catch(rethrowCancel);
      // the garment from the model, everything else from `base` (composite.ts)
      const pass = { blob: g.blob, type: g.type, category: garment.category, skinTone: garment.skinTone };
      base = (await dressPass(base, photo, landmarks, pass, run, (s) => working(describeStatus(s)), signal)).image;
      recordPass();
      keepPass(passKey(input.version, view, input.garments.slice(0, i + 1)), base);
      worn = [...worn, garment.slot];
    }
    looks.setView(key, view, { kind: 'done', image: base, before: photo });
    trackTryOn('ok', view, input.garments.length, startedAt, undefined, reused);
    return { quota: false, cancelled: false };
  } catch (err: unknown) {
    const e = asSpaceError(err);
    const outcome = outcomeOf(e);
    if (e.quota) recordQuota();
    trackTryOn(worn.length > 0 && !e.cancelled ? 'partial' : outcome, view, input.garments.length, startedAt, outcome, reused);
    const stop = { quota: e.quota, cancelled: e.cancelled };
    if (signal.aborted && running?.version !== useApp.getState().photoVersion) {
      // stopped because the photos changed: show nothing made from the old ones
      looks.setView(key, view, { kind: 'error', message: 'Stopped: your photos changed.', detail: null, retryable: false });
      return stop;
    }
    if (worn.length > 0) {
      const missingNames = input.garments.filter((g) => !worn.includes(g.slot)).map((g) => g.name.split(' in ')[0]);
      looks.setView(key, view, { kind: 'done', image: base, before: photo, note: `Without the ${missingNames.join(' and ')}: ${e.message}` });
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

/** The id a look is charged under: its front photo and garments (the side photo is the same look). */
export function tryOnLookId(input: Ready): Promise<string> {
  return lookId([input.photos.front ?? '', ...input.garments.map((g) => g.image)]);
}

/**
 * One of the shopper's looks for this try-on, if it needs GPU passes (photos already made cost nothing). Null: the
 * shopper must sign in or buy more first (the dialog is open).
 */
async function ticketFor(input: Ready, views: View[]): Promise<Ticket | 'free' | null> {
  if (passesNeeded(input, views) === 0 || billingOff()) return 'free';
  return admit(await tryOnLookId(input));
}

/**
 * The account check awaits the server, and the shopper may replace or remove a photo meanwhile: then nothing may be
 * sent (removed photos are never sent again) and the look is given back. True when the run can go ahead.
 */
async function stillCurrent(input: Ready, ticket: Ticket | 'free'): Promise<boolean> {
  if (input.version === useApp.getState().photoVersion) return true;
  if (ticket !== 'free') await release(ticket);
  return false;
}

/** Gives the look back if the try-on made no photo at all (failed, cancelled, out of GPU time). */
async function settle(ticket: Ticket | 'free', key: string): Promise<void> {
  if (ticket !== 'free' && doneCount(useLooks.getState().looks[key]) === 0) await release(ticket);
}

/** Re-dresses every photo for the outfit on screen (starting over if it was shot before). */
export function makeTryOnLook(run: TryOnRunner = runSpace): Promise<void> {
  const input = tryOnInput(useApp.getState());
  if (!input.ready) return Promise.resolve();
  const { key } = input;
  return exclusive(key, async () => {
    const previous = useLooks.getState().looks[key];
    // a reshoot keeps the side photo if the shopper had asked for it (finished passes make it free)
    const order: View[] = previous?.order.includes('side') && input.photos.side ? [...input.order, 'side'] : input.order;
    const ticket = await ticketFor(input, order);
    if (!ticket || !(await stillCurrent(input, ticket))) return;
    inputs.set(key, input);
    const { top, bottom } = useApp.getState().outfit;
    useLooks.getState().start(key, input.caption, order, { ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) });
    await shootViews(key, order, input, run);
    await settle(ticket, key);
    // A reshoot that produced nothing: keep the earlier photos rather than a failed, empty look.
    const look = useLooks.getState().looks[key];
    if (previous && doneCount(previous) > 0 && doneCount(look) === 0) {
      const failed = look?.views[order[0]];
      const reason = failed?.kind === 'error' ? failed.message : 'The new try-on failed.';
      useLooks.getState().restore(previous, `Couldn't redo this try-on: ${reason} Your earlier photos are kept.`);
    }
  });
}

/** Tries one photo again, only while its photos are still the ones on screen. */
export function retryTryOnView(key: string, view: View, run: TryOnRunner = runSpace): Promise<void> {
  const input = inputs.get(key);
  if (!input || !canRetryTryOn(key)) return Promise.resolve();
  return exclusive(key, async () => {
    const ticket = await ticketFor(input, [view]);
    if (!ticket || !(await stillCurrent(input, ticket))) return;
    await shootViews(key, [view], input, run);
    await settle(ticket, key);
  });
}

/** True when the look's side photo can be tried on: given, not tried yet, and still the photo on screen. */
export function canAddSide(key: string): boolean {
  const input = inputs.get(key);
  const look = useLooks.getState().looks[key];
  return Boolean(input?.photos.side && look && !look.order.includes('side') && canRetryTryOn(key));
}

/** Passes the side photo would take for this look. */
export function sidePasses(key: string): number {
  const input = inputs.get(key);
  return input ? passesNeeded(input, ['side']) : 0;
}

/** Tries the outfit on the side photo too (asked for after the front, so the front alone costs half). */
export function addSideView(key: string, run: TryOnRunner = runSpace): Promise<void> {
  const input = inputs.get(key);
  if (!input || !canAddSide(key)) return Promise.resolve();
  useLooks.getState().addView(key, 'side');
  return exclusive(key, () => shootViews(key, ['side'], input, run));
}

/** Looks made from the photos on screen, with at least one finished photo: the ones the shopper can go back to. */
export function reachableLooks(looks: Record<string, Look>): Look[] {
  return Object.values(looks)
    .filter((l) => l.outfit && doneCount(l) > 0 && canRetryTryOn(l.key))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
