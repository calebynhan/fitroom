import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLookRequest } from '@api/look';
import catalog from '../../public/catalog.json';
import { parseCatalog } from '../catalog/types';
import { useLooks } from '../state/looks';
import { useApp } from '../state/store';
import { lookInput, missingParts } from './request';
import { makeLook, postView, retryView } from './shoot';

vi.mock('../photos/prepare', () => ({ downscaleDataUrl: async (d: string) => d }));

const PHOTO = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 600, height: 900 };
const SHOT = 'data:image/jpeg;base64,QUJD';

function readyState() {
  useApp.setState({
    catalog: parseCatalog(catalog),
    outfit: { top: { itemId: 'E453754-000', colorCode: '67' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
    scene: 'studio',
    profile: { units: 'metric', heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84 },
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
    expect(input.caption.meta).toBe('TOP S · BOTTOMS S · STUDIO · 178 CM');
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
