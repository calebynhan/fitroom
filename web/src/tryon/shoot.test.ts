import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../../public/catalog.json';
import { EMPTY_PROFILE } from '../body/profile';
import { parseCatalog } from '../catalog/types';
import { useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { useAllowance } from './allowance';
import { addSideView, canAddSide, canRetryTryOn, cancelTryOn, forgetPasses, makeTryOnLook, passesNeeded, reachableLooks, retryTryOnView, tryOnInput } from './shoot';
import { SpaceError, type GarmentPhotoType, type TryOnCategory, type TryOnRunner } from './space';

const PHOTO = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 600, height: 900 };

let version = 0;
/** A fresh photo version per call, so no finished pass carries over between tests. */
function readyState(side = false) {
  version += 100; // setPhoto bumps the store's version too: stay well clear of it
  useApp.setState({
    catalog: parseCatalog(catalog),
    outfit: { top: { itemId: 'E453754-000', colorCode: '67' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
    scene: 'studio',
    profile: { ...EMPTY_PROFILE },
    photos: { front: PHOTO, side: side ? PHOTO : null, face: null },
    photoVersion: version,
  });
}

/** A fake Space: records each pass, returns "<input>+<category>" so the chain of passes is visible in the result. */
function fakeSpace(fail?: (category: TryOnCategory, n: number) => SpaceError | null) {
  const passes: { person: string; category: TryOnCategory; garment?: string; type?: GarmentPhotoType }[] = [];
  const run: TryOnRunner = async (person, garment, category, type, onStatus) => {
    onStatus({ kind: 'queued', position: 1, etaS: 30 });
    const name = await person.text();
    passes.push({ person: name, category, garment: await garment.text(), type });
    const err = fail?.(category, passes.length);
    if (err) throw err;
    return new Blob([`${name}+${category}`], { type: 'image/webp' });
  };
  return { run, passes };
}

const decode = (dataUrl: string) => atob(dataUrl.split(',')[1]);

beforeEach(() => {
  readyState();
  useLooks.setState({ looks: {}, busy: null, latest: null, remaining: null });
  // The person photo arrives as a data URL; garment photos come from the same-site /uniqlo/ proxy.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.startsWith('data:') ? new Response(new Blob(['me'])) : new Response(new Blob([`garment ${url}`], { type: 'image/jpeg' })),
    ),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined); // no canvas in Node: results stay unsharpened
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tryOnInput', () => {
  it('needs only a front photo and something to wear, and does not depend on the size', () => {
    useApp.setState({ photos: { front: null, side: null, face: null } });
    expect(tryOnInput(useApp.getState())).toEqual({ ready: false, missing: ['front photo'] });
    readyState();
    const input = tryOnInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    expect(input.order).toEqual(['front']);
    expect(input.garments.map((g) => [g.category, g.image])).toEqual([
      ['tops', '/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg'],
      ['bottoms', '/uniqlo/UQ/ST3/us/imagesgoods/475598/item/usgoods_09_475598_3x4.jpg'],
    ]);
    useApp.getState().setSize('top', 'L');
    expect((tryOnInput(useApp.getState()) as { key: string }).key).toBe(input.key);
    useApp.getState().setColor('top', '09');
    expect((tryOnInput(useApp.getState()) as { key: string }).key).not.toBe(input.key);
  });

  it('keeps the side photo for later and shoots the front first', () => {
    readyState(true);
    const input = tryOnInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    expect(input.order).toEqual(['front']);
    expect(input.photos.side).toBeDefined();
    expect(passesNeeded(input)).toBe(2);
    expect(passesNeeded(input, ['front', 'side'])).toBe(4);
  });
});

describe('makeTryOnLook', () => {
  it('puts the top on, then the bottoms on that result: the front first, the side on request', async () => {
    readyState(true);
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    expect(space.passes.map(({ person, category }) => ({ person, category }))).toEqual([
      { person: 'me', category: 'tops' },
      { person: 'me+tops', category: 'bottoms' },
    ]);
    const key = useLooks.getState().latest!;
    expect(useLooks.getState().looks[key].order).toEqual(['front']);
    expect(canAddSide(key)).toBe(true);
    await addSideView(key, space.run);
    expect(space.passes).toHaveLength(4);
    expect(canAddSide(key)).toBe(false);
    // the garment-only shot is tried first; with no canvas to inspect it, it's sent as worn ("model")
    expect(space.passes[0].garment).toBe('garment /uniqlo/UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg');
    expect(space.passes[0].type).toBe('model');
    const look = useLooks.getState().looks[useLooks.getState().latest!];
    expect(look.order).toEqual(['front', 'side']);
    for (const view of look.order) {
      const state = look.views[view];
      expect(state.kind).toBe('done');
      if (state.kind === 'done') expect(decode(state.image)).toBe('me+tops+bottoms');
    }
    expect(useLooks.getState().busy).toBeNull();
  });

  it('keeps the top when the bottoms fail, and stops once the free allowance is gone', async () => {
    readyState(true);
    const quota = new SpaceError('quota gone', true, true);
    const space = fakeSpace((category) => (category === 'bottoms' ? quota : null));
    await makeTryOnLook(space.run);
    expect(space.passes).toHaveLength(2);
    expect(useAllowance.getState().allowance.exhausted).toBe(true);
    const look = useLooks.getState().looks[useLooks.getState().latest!];
    const front = look.views.front;
    expect(front.kind).toBe('done');
    if (front.kind === 'done') {
      expect(decode(front.image)).toBe('me+tops');
      expect(front.note).toBe('Without the Ultra Stretch Pants: quota gone');
    }
  });

  it('a side photo asked for after the allowance is gone says so', async () => {
    readyState(true);
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    const key = useLooks.getState().latest!;
    const out = fakeSpace(() => new SpaceError('quota gone', true, true));
    await addSideView(key, out.run);
    expect(useLooks.getState().looks[key].views.side).toMatchObject({ kind: 'error', message: 'quota gone' });
  });

  it('shows the failure when nothing could be made, and retries one photo alone', async () => {
    let failing = true;
    const space = fakeSpace(() => (failing ? new SpaceError('busy', true) : null));
    await makeTryOnLook(space.run);
    const key = useLooks.getState().latest!;
    expect(useLooks.getState().looks[key].views.front).toMatchObject({ kind: 'error', message: 'busy', retryable: true });
    failing = false;
    await retryTryOnView(key, 'front', space.run);
    expect(useLooks.getState().looks[key].views.front.kind).toBe('done');
  });

  it('keeps earlier photos when trying the same outfit again fails completely', async () => {
    let failing = false;
    const space = fakeSpace(() => (failing ? new SpaceError('busy', true) : null));
    await makeTryOnLook(space.run);
    forgetPasses(); // otherwise the reshoot is free and can't fail
    failing = true;
    await makeTryOnLook(space.run);
    const look = useLooks.getState().looks[useLooks.getState().latest!];
    expect(look.views.front.kind).toBe('done');
    expect(look.notice).toMatch(/earlier photos are kept/);
  });
});

const otherBottomColour = () =>
  parseCatalog(catalog)
    .find((i) => i.id === 'E475598-000')!
    .colors.map((c) => c.code)
    .find((c) => !['09', '08'].includes(c))!;

describe('reusing finished passes', () => {
  it('changing only the bottoms reuses the photo in the top', async () => {
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    useApp.getState().setColor('bottom', otherBottomColour());
    const input = tryOnInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    expect(passesNeeded(input)).toBe(1);
    await makeTryOnLook(space.run);
    expect(space.passes.map((p) => `${p.person}:${p.category}`)).toEqual(['me:tops', 'me+tops:bottoms', 'me+tops:bottoms']);
    const front = useLooks.getState().looks[useLooks.getState().latest!].views.front;
    expect(front.kind === 'done' && decode(front.image)).toBe('me+tops+bottoms');
  });

  it('trying the same outfit again costs nothing', async () => {
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    await makeTryOnLook(space.run);
    expect(space.passes).toHaveLength(2);
    expect(useLooks.getState().looks[useLooks.getState().latest!].views.front.kind).toBe('done');
  });

  it('a retry after a partial photo starts from the part that worked', async () => {
    const quota = new SpaceError('quota gone', true, true);
    const space = fakeSpace((category) => (category === 'bottoms' ? quota : null));
    await makeTryOnLook(space.run);
    const key = useLooks.getState().latest!;
    const later = fakeSpace();
    await retryTryOnView(key, 'front', later.run);
    expect(later.passes.map((p) => `${p.person}:${p.category}`)).toEqual(['me+tops:bottoms']);
    const front = useLooks.getState().looks[key].views.front;
    expect(front.kind === 'done' && decode(front.image)).toBe('me+tops+bottoms');
  });

  it('lists the outfits tried on these photos, newest first, and can go back to one', async () => {
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    const firstOutfit = useApp.getState().outfit;
    useApp.getState().setColor('bottom', otherBottomColour());
    await new Promise((r) => setTimeout(r, 2)); // a later start time
    await makeTryOnLook(space.run);
    const list = reachableLooks(useLooks.getState().looks);
    expect(list).toHaveLength(2);
    expect(list[1].outfit?.bottom?.colorCode).toBe(firstOutfit.bottom?.colorCode);
    useApp.getState().applyOutfit(list[1].outfit!);
    const input = tryOnInput(useApp.getState());
    expect(input.ready && input.key).toBe(list[1].key); // the earlier look is on screen again, at no cost
    useApp.getState().setPhoto('front', PHOTO);
    expect(reachableLooks(useLooks.getState().looks)).toHaveLength(0); // made from the old photo
  });

  it('a new photo starts from scratch', async () => {
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    useApp.getState().setPhoto('front', PHOTO); // the same picture, chosen again: a new version
    await makeTryOnLook(space.run);
    expect(space.passes).toHaveLength(4);
  });
});

describe('garment photo fallback', () => {
  it('falls back to the catalogue photo when there is no garment-only shot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('data:')) return new Response(new Blob(['me']));
        if (url.includes('/goods_')) return new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response(new Blob([`garment ${url}`], { type: 'image/jpeg' }));
      }),
    );
    useApp.getState().setColor('bottom', '08'); // a colour not fetched by earlier tests (photos are cached per URL)
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    expect(space.passes[1].garment).toBe('garment /uniqlo/UQ/ST3/us/imagesgoods/475598/item/usgoods_08_475598_3x4.jpg');
  });
});

/** A Space that waits until released, and honours cancellation like runSpace does. */
function heldSpace() {
  const sent: string[] = [];
  let release: (() => void) | null = null;
  const run: TryOnRunner = (person, _garment, category, _type, _onStatus, signal) =>
    new Promise<Blob>((resolve, reject) => {
      void person.text().then((p) => sent.push(`${p}:${category}`));
      const abort = () => reject(new SpaceError('Cancelled.', true, false, null, true));
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      release = () => resolve(new Blob(['done'], { type: 'image/webp' }));
    });
  const started = async () => {
    for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  return { run, sent, started, release: () => release?.() };
}

describe('cancel, removed photos and safe retries', () => {
  it('Cancel stops the run at once and frees the app', async () => {
    const space = heldSpace();
    const shooting = makeTryOnLook(space.run);
    await space.started();
    expect(useLooks.getState().busy).not.toBeNull();
    cancelTryOn();
    await shooting;
    const key = useLooks.getState().latest!;
    expect(useLooks.getState().busy).toBeNull();
    expect(useLooks.getState().looks[key].views.front).toMatchObject({ kind: 'error', message: 'Cancelled.', retryable: true });
  });

  it('removing a photo stops a run still using it, and nothing is retried with it', async () => {
    readyState(true);
    const space = heldSpace();
    const shooting = makeTryOnLook(space.run);
    await space.started();
    const key = useLooks.getState().latest!;
    useApp.getState().setPhoto('front', null); // the shopper removes their front photo mid-run
    await shooting;
    expect(useLooks.getState().busy).toBeNull();
    expect(useLooks.getState().looks[key].views.front).toMatchObject({ kind: 'error', message: 'Stopped: your photos changed.', retryable: false });
    const sentBefore = space.sent.length;
    expect(canRetryTryOn(key)).toBe(false);
    expect(canAddSide(key)).toBe(false);
    await retryTryOnView(key, 'front', space.run);
    await addSideView(key, space.run);
    expect(space.sent.length).toBe(sentBefore); // nothing uploaded
  });

  it('a retry that fails keeps the photo already there', async () => {
    const quota = new SpaceError('quota gone', true, true);
    const space = fakeSpace((category) => (category === 'bottoms' ? quota : null));
    await makeTryOnLook(space.run); // top on, bottoms refused: a partial photo with a note
    const key = useLooks.getState().latest!;
    const partial = useLooks.getState().looks[key].views.front;
    expect(partial.kind).toBe('done');
    forgetPasses(); // so the retry has to start over (otherwise it reuses the top, tested above)
    const stillOut = fakeSpace(() => quota); // the retry fails on the first pass
    await retryTryOnView(key, 'front', stillOut.run);
    const after = useLooks.getState().looks[key].views.front;
    expect(after.kind).toBe('done');
    if (after.kind === 'done' && partial.kind === 'done') {
      expect(after.image).toBe(partial.image);
      expect(after.note).toBe('quota gone Your earlier photo is kept.');
    }
  });
});

describe('product photo loading', () => {
  it("doesn't settle for the styled catalogue photo when the garment-only one fails on the network", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('data:')) return new Response(new Blob(['me']));
        if (url.includes('/goods_')) throw new TypeError('Failed to fetch');
        return new Response(new Blob([`garment ${url}`], { type: 'image/jpeg' }));
      }),
    );
    useApp.getState().setColor('top', '09'); // a colour no earlier test cached
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    expect(space.passes).toHaveLength(0);
    const key = useLooks.getState().latest!;
    expect(useLooks.getState().looks[key].views.front).toMatchObject({ kind: 'error', retryable: true, message: expect.stringMatching(/Check your connection/) });
  });
});
