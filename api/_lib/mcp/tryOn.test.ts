import { describe, expect, it } from 'vitest';
import { garmentOnlyUrl } from '../fit/garmentPhoto';
import { fashnPass, fetchImage, photoUrl, safePublicUrl, tryOnStatus, type TryOnDeps } from './tryOn';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function deps(routes: (url: string, init?: RequestInit) => Response | Promise<Response>): TryOnDeps & { calls: string[] } {
  let clock = 0;
  const calls: string[] = [];
  return {
    calls,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (input, init) => {
      calls.push(String(input));
      return routes(String(input), init);
    },
  };
}

describe('photo links', () => {
  it('accepts a ChatGPT file object or a plain URL', () => {
    expect(photoUrl({ download_url: 'https://a.example/x', file_id: 'f' })).toBe('https://a.example/x');
    expect(photoUrl('https://a.example/y')).toBe('https://a.example/y');
    expect(photoUrl({ file_id: 'f' })).toBeNull();
    expect(photoUrl(42)).toBeNull();
  });

  it('only fetches public https hosts', () => {
    for (const bad of ['http://a.example/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://db.internal/x', 'https://u:p@a.example/x', 'not a url', 'https://intranet/x']) {
      expect(safePublicUrl(bad), bad).toBeNull();
    }
    expect(safePublicUrl('https://files.oaiusercontent.com/file-abc?sig=1')).not.toBeNull();
  });

  it('sniffs the image type instead of trusting the header, and caps the size', async () => {
    const ok = await fetchImage('https://a.example/p', deps(() => new Response(JPEG, { headers: { 'Content-Type': 'application/octet-stream' } })), 1000);
    expect(ok).toEqual({ ok: true, dataUrl: `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}` });
    const html = await fetchImage('https://a.example/p', deps(() => new Response('<html>', { headers: { 'Content-Type': 'image/jpeg' } })), 1000);
    expect(html).toEqual({ ok: false, reason: 'type' });
    const huge = await fetchImage('https://a.example/p', deps(() => new Response(JPEG, { headers: { 'Content-Length': String(20 * 1024 * 1024) } })), 1000);
    expect(huge).toEqual({ ok: false, reason: 'size' });
  });

  it('follows redirects, checking each hop', async () => {
    const d = deps((url) =>
      url === 'https://a.example/p'
        ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example/p2' } })
        : new Response(JPEG),
    );
    expect((await fetchImage('https://a.example/p', d, 1000)).ok).toBe(true);
    expect(d.calls).toEqual(['https://a.example/p', 'https://cdn.example/p2']);
    const evil = deps(() => new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/latest' } }));
    expect(await fetchImage('https://a.example/p', evil, 1000)).toEqual({ ok: false, reason: 'url' });
  });
});

describe('garment photos', () => {
  it('maps catalogue photos (absolute or same-site) to the garment-only shot', () => {
    expect(garmentOnlyUrl('https://image.uniqlo.com/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg')).toBe(
      'https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg',
    );
    expect(garmentOnlyUrl('/uniqlo/UQ/ST3/us/imagesgoods/475598/item/usgoods_09_475598_3x4.jpg')).toBe(
      '/uniqlo/UQ/ST3/WesternCommon/imagesgoods/475598/item/goods_09_475598_3x4.jpg',
    );
    expect(garmentOnlyUrl('https://image.uniqlo.com/UQ/ST3/us/imagesgoods/453754/sub/usgoods_453754_sub1_3x4.jpg')).toBeNull();
  });
});

describe('FASHN passes', () => {
  const run = (status: number, body: unknown) => () => Response.json(body, { status });

  it('polls until the result arrives', async () => {
    let polls = 0;
    const d = deps((url) => {
      if (url.endsWith('/run')) return Response.json({ id: 'abc', error: null });
      polls += 1;
      return Response.json(polls < 3 ? { status: 'processing' } : { status: 'completed', output: ['data:image/jpeg;base64,/9j/x'] });
    });
    expect(await fashnPass('data:image/jpeg;base64,a', 'data:image/jpeg;base64,b', 'tops', 'k', d, 60_000)).toEqual({ ok: true, image: 'data:image/jpeg;base64,/9j/x' });
    expect(polls).toBe(3);
  });

  it('turns FASHN errors into shopper words', async () => {
    const failed = (name: string) =>
      deps((url) => (url.endsWith('/run') ? Response.json({ id: 'x' }) : Response.json({ status: 'failed', error: { name, message: 'secret detail' } })));
    expect(await fashnPass('a', 'b', 'tops', 'k', failed('PoseError'), 60_000)).toMatchObject({ kind: 'photo', message: expect.stringContaining('head to toe') });
    expect(await fashnPass('a', 'b', 'tops', 'k', failed('ContentModerationError'), 60_000)).toMatchObject({ kind: 'photo' });
    expect(await fashnPass('a', 'b', 'tops', 'k', failed('UnavailableError'), 60_000)).toMatchObject({ kind: 'busy' });
    expect(await fashnPass('a', 'b', 'tops', 'k', deps(run(429, { error: 'OutOfCredits' })), 60_000)).toMatchObject({ kind: 'unavailable' });
    expect(await fashnPass('a', 'b', 'tops', 'k', deps(run(429, { error: 'ConcurrencyLimitExceeded' })), 60_000)).toMatchObject({ kind: 'busy' });
    expect(await fashnPass('a', 'b', 'tops', 'k', deps(run(500, { error: 'InternalServerError' })), 60_000)).toMatchObject({ kind: 'error' });
  });

  it('gives up at the deadline', async () => {
    const d = deps((url) => (url.endsWith('/run') ? Response.json({ id: 'x' }) : Response.json({ status: 'in_queue' })));
    expect(await fashnPass('a', 'b', 'bottoms', 'k', d, 10_000)).toMatchObject({ kind: 'busy', message: expect.stringContaining('too long') });
  });
});

describe('switch', () => {
  it('is off without a key and when paused', () => {
    expect(tryOnStatus({}).on).toBe(false);
    expect(tryOnStatus({ FASHN_API_KEY: 'k', TRYON_DISABLED: '1' }).on).toBe(false);
    expect(tryOnStatus({ FASHN_API_KEY: ' k ' })).toEqual({ on: true, key: 'k' });
  });
});
