import { describe, expect, it, vi } from 'vitest';
import type { AccountView } from '@api/accountTypes';
import type { CatalogItem } from '../catalog/types';
import { SpaceError, type TryOnRunner } from '../tryon/space';
import { panelData, tryOn, type Deps, type PanelData, type Phase, type ToolAnswer } from './run';

const item = (id: string, slot: 'top' | 'bottom', name: string) =>
  ({ id, name, slot, shape: slot === 'top' ? 'sweater' : 'pants', price: 30, salePrice: null, fabric: 'jersey', fit: 'regular', url: 'u', colors: [{ code: '09', name: 'Black', hex: '#000', swatch: '' }], sizes: ['M'], sizeChart: null }) as unknown as CatalogItem;

const account: AccountView = { billing: true, googleClientId: 'g', freeLooks: 5, pack: null, user: { email: 'a@b.c', exempt: false, freeUsed: 0, credits: 0, left: 5 } };
const DATA: PanelData = {
  origin: 'https://fitroom.test',
  items: [
    { item: item('E1', 'top', 'Washable Milano Ribbed Sweater'), colorCode: '09', garment: 'https://fitroom.test/uniqlo/top.jpg' },
    { item: item('E2', 'bottom', 'Ultra Stretch Pants'), colorCode: '09', garment: 'https://fitroom.test/uniqlo/pants.jpg' },
  ],
  photo: { download_url: 'https://files.chat/me.jpg', file_id: 'file_1', mime_type: 'image/jpeg' },
  body: { heightCm: 178, weightKg: 65 },
  account,
  info: 'https://fitroom.test/try-ons.html',
};

function deps(over: Partial<Deps> & { calls?: string[]; runs?: string[] } = {}): Deps & { calls: string[]; runs: string[] } {
  const calls = over.calls ?? [];
  const runs = over.runs ?? [];
  const run: TryOnRunner = async (_person, _garment, category) => {
    runs.push(category);
    return new Blob([category], { type: 'image/webp' });
  };
  return {
    calls,
    runs,
    callTool: async (name: string): Promise<ToolAnswer> => {
      calls.push(name);
      if (name === 'charge_look') return { structuredContent: { ok: true, charged: true } };
      if (name === 'fetch_photo') return { structuredContent: { ok: true }, _meta: { photo: 'data:image/jpeg;base64,/9j/' } };
      return { structuredContent: { ok: true } };
    },
    fetchFn: (async () => new Response(new Blob([new Uint8Array([0xff, 0xd8])]), { headers: { 'content-type': 'image/jpeg' } })) as typeof fetch,
    prepare: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA', width: 900, height: 1600 }),
    garment: async (url: string) => ({ blob: new Blob([url]), type: 'flat-lay', url }),
    run,
    sharpen: async () => 'data:image/jpeg;base64,DONE',
    ...over,
  };
}

const go = (d: Deps) => {
  const phases: Phase[] = [];
  return tryOn(DATA, d, (p) => phases.push(p), new AbortController().signal).then((final) => ({ final, phases }));
};

describe('panel try-on', () => {
  it('reads the panel data from a try_on result only', () => {
    expect(panelData({ _meta: { fitroom: DATA } })).toBe(DATA);
    expect(panelData({ content: [{ type: 'text', text: 'Sign in' }], isError: true })).toBeNull();
  });

  it('charges the look, puts on the top then the bottoms, and shows the photo', async () => {
    const d = deps();
    const { final, phases } = await go(d);
    expect(final).toEqual({ kind: 'done', image: 'data:image/jpeg;base64,DONE' });
    expect(d.calls).toEqual(['charge_look']);
    expect(d.runs).toEqual(['tops', 'bottoms']);
    expect(phases.some((p) => p.kind === 'working' && p.status.includes('Ribbed Sweater'))).toBe(true);
  });

  it("asks the server for the photo when the panel can't fetch it", async () => {
    const d = deps({ fetchFn: (async () => Promise.reject(new TypeError('CSP'))) as typeof fetch });
    const { final } = await go(d);
    expect(final.kind).toBe('done');
    expect(d.calls).toEqual(['fetch_photo', 'charge_look']);
  });

  it('stops before the Space when the account has no try-ons left, with the reason and no checkout', async () => {
    const d = deps();
    d.callTool = async (name) => {
      d.calls.push(name);
      return { isError: true, content: [{ type: 'text', text: 'This FitRoom account has used its 5 free try-ons and has none left.' }], structuredContent: { ok: false, reason: 'no_try_ons' } };
    };
    const { final } = await go(d);
    expect(final).toMatchObject({ kind: 'empty' });
    expect(d.runs).toEqual([]);
  });

  it('gives the look back when nothing could be made', async () => {
    const d = deps({ run: async () => Promise.reject(new SpaceError('The free try-on model is busy right now.', true)) });
    const { final } = await go(d);
    expect(final).toEqual({ kind: 'error', message: 'The free try-on model is busy right now.', retryable: true });
    expect(d.calls).toEqual(['charge_look', 'refund_look']);
  });

  it('keeps a partial photo (top on, bottoms failed) and its charge', async () => {
    const runs: string[] = [];
    const d = deps({
      runs,
      run: async (_p, _g, category) => {
        runs.push(category);
        if (category === 'bottoms') throw new SpaceError('quota', true, true);
        return new Blob(['top']);
      },
    });
    const { final } = await go(d);
    expect(final).toMatchObject({ kind: 'done', note: expect.stringMatching(/^Without the Stretch Pants: Hugging Face's free GPU time/) });
    expect(d.calls).toEqual(['charge_look']);
  });

  it('says when the free GPU time is used up, and offers no retry', async () => {
    const d = deps({ run: async () => Promise.reject(new SpaceError('quota', true, true)) });
    const { final } = await go(d);
    expect(final).toMatchObject({ kind: 'error', retryable: false, message: expect.stringContaining('Hugging Face') });
  });

  it('a photo that cannot be opened stops before charging', async () => {
    const d = deps({ prepare: vi.fn(async () => Promise.reject(new Error('That photo is too small.'))) });
    const { final } = await go(d);
    expect(final).toEqual({ kind: 'error', message: 'That photo is too small.', retryable: false });
    expect(d.calls).toEqual([]);
  });
});
