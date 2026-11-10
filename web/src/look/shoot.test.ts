import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLookRequest } from '@api/look';
import catalog from '../../public/catalog.json';
import { EMPTY_PROFILE } from '../body/profile';
import { parseCatalog } from '../catalog/types';
import { useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { lookInput, missingParts } from './request';
import { canCompare, makeLook, postView, retryView, shootCompare } from './shoot';

vi.mock('../photos/prepare', () => ({ downscaleDataUrl: async (d: string) => d }));


const PHOTO = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 600, height: 900 };
const SHOT = 'data:image/jpeg;base64,QUJD';

function readyState() {
  useApp.setState({
    catalog: parseCatalog(catalog),
    outfit: { top: { itemId: 'E453754-000', colorCode: '67' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
    scene: 'studio',
    profile: { ...EMPTY_PROFILE, units: 'metric', heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84 },
    photos: { front: PHOTO, side: PHOTO, face: PHOTO },
    photoVersion: 3,
  });
}

type Handler = (body: Record<string, unknown>) => { status?: number; json: Record<string, unknown> };

function serve(handler: Handler) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(body);
      const { status = 200, json } = handler(body);
      return Response.json(json, { status });
    }),
  );
  return calls;
}

beforeEach(() => {
  readyState();
  useLooks.setState({ looks: {}, busy: null, latest: null, remaining: null });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lookInput', () => {
  it('lists what is missing in order', () => {
    useApp.setState({ photos: { front: PHOTO, side: null, face: null }, profile: { ...useApp.getState().profile, weightKg: null } });
    expect(missingParts(useApp.getState())).toEqual(['side photo', 'face profile', 'height and weight']);
    expect(lookInput(useApp.getState()).ready).toBe(false);
  });

  it('builds a request the server accepts, with recommended sizes and fit', () => {
    const input = lookInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    const parsed = parseLookRequest({ ...input.base, view: 'front' } as unknown as Record<string, unknown>);
    expect(parsed.ok).toBe(true);
    expect(input.base.items).toEqual([
      expect.objectContaining({ slot: 'top', name: 'Washable Milano Ribbed Sweater', size: 'S', ease: 'regular', length: 'regular', image: expect.stringContaining('usgoods_67_453754') }),
      expect.objectContaining({ slot: 'bottom', name: 'Ultra Stretch Pants', color: 'Black', size: 'S', ease: 'regular', length: 'ankle' }),
    ]);
    expect(input.caption.meta).toBe('Top S · Bottoms S · Studio · 178\u00a0cm');
  });

  it('changes key when anything in the photo would change', () => {
    const key = (lookInput(useApp.getState()) as { key: string }).key;
    useApp.getState().setSize('top', 'L');
    const sized = lookInput(useApp.getState()) as { key: string; base: { items: { size?: string; ease?: string }[] } };
    expect(sized.key).not.toBe(key);
    expect(sized.base.items[0]).toMatchObject({ size: 'L', ease: 'relaxed' });
    useApp.getState().setPhoto('face', PHOTO);
    expect((lookInput(useApp.getState()) as { key: string }).key).not.toBe(sized.key);
  });
});

describe('makeLook', () => {
  it('shoots the front, then the three angles with its token and the front shot', async () => {
    const calls = serve((b) => ({ json: b.view === 'front' ? { image: SHOT, view: 'front', lookToken: 'tok', remaining: 2 } : { image: SHOT, view: b.view, remaining: 2 } }));
    await makeLook();
    expect(calls.map((c) => c.view)).toEqual(['front', 'three_quarter', 'side', 'back']);
    expect(calls[0]).not.toHaveProperty('lookToken');
    for (const c of calls.slice(1)) expect(c).toMatchObject({ lookToken: 'tok', reference: SHOT });
    const { looks, latest, busy, remaining } = useLooks.getState();
    expect(busy).toBeNull();
    expect(remaining).toBe(2);
    expect(Object.values(looks[latest!].views).every((v) => v.kind === 'done')).toBe(true);
  });

  it('stops after a failed front shot and retries it, then the angles', async () => {
    let fail = true;
    const calls = serve((b) => {
      if (b.view === 'front' && fail) return { status: 503, json: { error: 'The photo service is busy right now.', retryable: true, remaining: 3 } };
      return { json: { image: SHOT, view: b.view, lookToken: 'tok', remaining: 2 } };
    });
    await makeLook();
    const key = useLooks.getState().latest!;
    expect(calls).toHaveLength(1);
    expect(useLooks.getState().looks[key].views.front).toMatchObject({ kind: 'error', retryable: true });
    expect(useLooks.getState().looks[key].views.back.kind).toBe('waiting');

    fail = false;
    await retryView(key, 'front');
    expect(calls.map((c) => c.view)).toEqual(['front', 'front', 'three_quarter', 'side', 'back']);
    expect(Object.values(useLooks.getState().looks[key].views).every((v) => v.kind === 'done')).toBe(true);
  });

  it('retries one failed angle alone', async () => {
    let backFails = true;
    const calls = serve((b) => {
      if (b.view === 'back' && backFails) return { status: 504, json: { error: 'The photo service took too long.', retryable: true } };
      return { json: { image: SHOT, view: b.view, lookToken: 'tok', remaining: 2 } };
    });
    await makeLook();
    const key = useLooks.getState().latest!;
    expect(useLooks.getState().looks[key].views.back.kind).toBe('error');
    backFails = false;
    await retryView(key, 'back');
    expect(calls.map((c) => c.view).slice(4)).toEqual(['back']);
    expect(useLooks.getState().looks[key].views.back.kind).toBe('done');
  });

  it('keeps the earlier photos when shooting the same look again fails', async () => {
    let failFront = false;
    serve((b) => {
      if (b.view === 'front' && failFront) return { status: 422, json: { error: 'The safety filter declined this one.', retryable: true } };
      return { json: { image: SHOT, view: b.view, lookToken: 'tok', remaining: 2 } };
    });
    await makeLook();
    const key = useLooks.getState().latest!;
    failFront = true;
    await makeLook();
    const look = useLooks.getState().looks[key];
    expect(Object.values(look.views).every((v) => v.kind === 'done')).toBe(true);
    expect(look.notice).toMatch(/earlier photos are kept/);
  });

  it('does nothing until the look is ready, and one look at a time', async () => {
    const calls = serve(() => ({ json: { image: SHOT, view: 'front', lookToken: 'tok', remaining: 2 } }));
    useApp.setState({ photos: { front: null, side: null, face: null } });
    await makeLook();
    expect(calls).toHaveLength(0);
    readyState();
    await Promise.all([makeLook(), makeLook()]);
    expect(calls.filter((c) => c.view === 'front')).toHaveLength(1);
  });
});

describe('lookInput compares', () => {
  it('offers the next size up per item, with its fit and the chart differences', () => {
    const input = lookInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    expect(input.compares.top).toEqual({ slot: 'top', size: 'M', ease: 'relaxed', length: 'regular', delta: { chestCm: 6, lengthCm: 3 } });
    expect(input.compares.bottom).toMatchObject({ slot: 'bottom', size: 'M', delta: { hipsCm: 6, inseamCm: 2 } });
  });

  it('follows the fit preference: a relaxed pick shoots in M and compares with the chart size', () => {
    useApp.getState().setProfile({ fitTop: 'relaxed' });
    const input = lookInput(useApp.getState());
    if (!input.ready) throw new Error('not ready');
    expect(input.base.items[0]).toMatchObject({ size: 'M', ease: 'relaxed' });
    expect(input.compares.top).toMatchObject({ size: 'S', delta: { chestCm: -6, lengthCm: -3 } });
  });
});

describe('shootCompare', () => {
  const answer = (b: Record<string, unknown>) =>
    b.compare
      ? { image: 'data:image/jpeg;base64,Q01Q', view: 'front', compare: b.compare, remaining: 2 }
      : { image: SHOT, view: b.view, lookToken: 'tok', remaining: 2 };

  it('shoots the front again in the other size with the token, for the look on screen', async () => {
    const calls = serve((b) => ({ json: answer(b) }));
    await makeLook();
    const key = useLooks.getState().latest!;
    expect(canCompare(key)).toBe(true);
    await shootCompare(key, 'top');
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({ view: 'front', lookToken: 'tok', reference: SHOT, compare: { slot: 'top', size: 'M' } });
    expect(parseLookRequest(last).ok).toBe(true);
    expect(useLooks.getState().looks[key].compares?.top).toEqual({ size: 'M', state: { kind: 'done', image: 'data:image/jpeg;base64,Q01Q' } });
    expect(useLooks.getState().busy).toBeNull();
  });

  it('shows why a comparison failed, and does nothing once the outfit changed', async () => {
    const calls = serve((b) => (b.compare ? { status: 429, json: { error: 'Each look can compare 2 sizes.', retryable: false, remaining: 2 } } : { json: answer(b) }));
    await makeLook();
    const key = useLooks.getState().latest!;
    await shootCompare(key, 'bottom');
    expect(useLooks.getState().looks[key].compares?.bottom?.state).toMatchObject({ kind: 'error', message: 'Each look can compare 2 sizes.', retryable: false });

    const before = calls.length;
    useApp.getState().setSize('top', 'L');
    await shootCompare(key, 'top');
    expect(calls).toHaveLength(before);
  });
});

describe('postView', () => {
  it('turns transport failures into messages', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await postView({}, offline)).toMatchObject({ error: expect.stringMatching(/reach the server/), retryable: true });
    const html = vi.fn(async () => new Response('<html>', { status: 504, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    expect(await postView({}, html)).toMatchObject({ detail: 'HTTP 504', retryable: true });
    const tooBig = vi.fn(async () => new Response('', { status: 413 })) as unknown as typeof fetch;
    expect(await postView({}, tooBig)).toMatchObject({ retryable: false });
  });
});
