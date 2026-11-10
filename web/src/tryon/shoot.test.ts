import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../../public/catalog.json';
import { EMPTY_PROFILE } from '../body/profile';
import { parseCatalog } from '../catalog/types';
import { useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { makeTryOnLook, retryTryOnView, tryOnInput } from './shoot';
import { SpaceError, type TryOnCategory, type TryOnRunner } from './space';

const PHOTO = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 600, height: 900 };

function readyState(side = false) {
  useApp.setState({
    catalog: parseCatalog(catalog),
    outfit: { top: { itemId: 'E453754-000', colorCode: '67' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
    scene: 'studio',
    profile: { ...EMPTY_PROFILE },
    photos: { front: PHOTO, side: side ? PHOTO : null, face: null },
    photoVersion: 1,
  });
}

/** A fake Space: records each pass, returns "<input>+<category>" so the chain of passes is visible in the result. */
function fakeSpace(fail?: (category: TryOnCategory, n: number) => SpaceError | null) {
  const passes: { person: string; category: TryOnCategory }[] = [];
  const run: TryOnRunner = async (person, _garment, category, onStatus) => {
    onStatus({ kind: 'queued', position: 1, etaS: 30 });
    const name = await person.text();
    passes.push({ person: name, category });
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
    vi.fn(async (url: string) => (url.startsWith('data:') ? new Response(new Blob(['me'])) : new Response(new Blob([`garment ${url}`])))),
  );
});
afterEach(() => vi.unstubAllGlobals());

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

  it('adds the side photo when given', () => {
    readyState(true);
    expect((tryOnInput(useApp.getState()) as { order: string[] }).order).toEqual(['front', 'side']);
  });
});

describe('makeTryOnLook', () => {
  it('puts the top on, then the bottoms on that result, for each photo in turn', async () => {
    readyState(true);
    const space = fakeSpace();
    await makeTryOnLook(space.run);
    expect(space.passes).toEqual([
      { person: 'me', category: 'tops' },
      { person: 'me+tops', category: 'bottoms' },
      { person: 'me', category: 'tops' },
      { person: 'me+tops', category: 'bottoms' },
    ]);
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
    expect(space.passes).toHaveLength(2); // the side photo was not attempted
    const look = useLooks.getState().looks[useLooks.getState().latest!];
    const front = look.views.front;
    expect(front.kind).toBe('done');
    if (front.kind === 'done') {
      expect(decode(front.image)).toBe('me+tops');
      expect(front.note).toBe('Without the Ultra Stretch Pants: quota gone');
    }
    expect(look.views.side).toMatchObject({ kind: 'error', retryable: true, message: expect.stringMatching(/Not tried/) });
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
    failing = true;
    await makeTryOnLook(space.run);
    const look = useLooks.getState().looks[useLooks.getState().latest!];
    expect(look.views.front.kind).toBe('done');
    expect(look.notice).toMatch(/earlier photos are kept/);
  });
});
