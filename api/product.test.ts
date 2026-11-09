import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './product';

// product.ts caches per product ID at module level, so every test uses its own ID.
interface Upstream {
  details?: { status: number; body?: unknown } | 'network';
  sizeCharts?: { status: number; body?: unknown } | 'network';
}

function details(name: string, crumbs: [string, string], tags: unknown[] = []) {
  return {
    status: 200,
    body: {
      status: 'ok',
      result: {
        name,
        prices: { base: { value: 19.9 }, promo: null },
        breadcrumbs: { class: { locale: crumbs[0] }, category: { locale: crumbs[1] } },
        colors: [{ displayCode: '09', name: 'BLACK' }],
        sizes: [{ name: 'S' }, { name: 'M' }],
        images: { main: { '09': { image: 'https://image.uniqlo.com/09.jpg' } } },
        tags,
      },
    },
  };
}

function sizeCharts(id: string) {
  return {
    status: 200,
    body: {
      status: 'ok',
      result: [
        {
          productId: id,
          sizeChart: [{ name: 'M', sizeParts: [{ code: 'body-width', measurements: [{ value: '54', unit: 'cm' }] }] }],
          bodyMeasurements: [{ name: 'M', sizeParts: [{ code: 'nude-chest', measurements: [{ value: '96 - 104', unit: 'cm' }] }] }],
        },
      ],
    },
  };
}

function stubUniqlo(upstream: Upstream): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const reply = url.includes('/size-charts') ? upstream.sizeCharts : url.includes('/details') ? upstream.details : undefined;
      if (reply === 'network') throw new TypeError('fetch failed');
      if (!reply) return new Response('', { status: 404 }); // swatch chips -> colour-code fallback
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    }),
  );
  return calls;
}

function post(body: unknown, ip?: string): Request {
  return new Request('http://localhost/api/product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip && { 'x-forwarded-for': ip }) },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/product', () => {
  it('returns a full catalog item with fit and size chart', async () => {
    stubUniqlo({
      details: details('Crew Neck T-Shirt', ['T-Shirts, Sweats & Fleece', 'T-Shirts'], [{ group: 'top-fit', tag: 'regular' }]),
      sizeCharts: sizeCharts('E100001-000'),
    });
    const res = await POST(post({ url: 'https://www.uniqlo.com/us/en/products/E100001-000/00?colorDisplayCode=09' }));
    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item).toMatchObject({
      id: 'E100001-000',
      shape: 'tee',
      slot: 'top',
      fit: 'regular',
      sizes: ['S', 'M'],
      sizeChart: { M: { chestCm: 104, body: { chestCm: [96, 104] }, garment: { chestCm: 108 } } },
    });
    expect(item.colors[0]).toMatchObject({ code: '09', image: 'https://image.uniqlo.com/09.jpg' });
    expect(item.colors[0].hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('still returns the item, with sizeChart null, when the size chart call fails', async () => {
    stubUniqlo({ details: details('Slim Chino Pants', ['Bottoms', 'Chinos']), sizeCharts: { status: 500 } });
    const res = await POST(post({ url: 'E100002-000' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ shape: 'pants', fit: 'slim', sizeChart: null });
  });

  it('does not cache an item whose size chart failed, so the next request picks the chart up', async () => {
    const tee = details('Crew Neck T-Shirt', ['T-Shirts, Sweats & Fleece', 'T-Shirts']);
    stubUniqlo({ details: tee, sizeCharts: { status: 500 } });
    expect((await (await POST(post({ url: 'E100006-000' }))).json()).sizeChart).toBeNull();
    stubUniqlo({ details: tee, sizeCharts: sizeCharts('E100006-000') });
    expect((await (await POST(post({ url: 'E100006-000' }))).json()).sizeChart).toMatchObject({ M: { chestCm: 104 } });
  });

  it('explains unsupported items (shorts) with 422', async () => {
    stubUniqlo({ details: details('Chino Shorts', ['Bottoms', 'Shorts']), sizeCharts: sizeCharts('E100003-000') });
    const res = await POST(post({ url: 'E100003-000' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'Chino Shorts (Shorts) is not supported yet. Try a T-shirt, sweater or pants.',
      code: 'unsupported',
    });
  });

  it('rejects input without a product ID before calling UNIQLO', async () => {
    const calls = stubUniqlo({});
    const res = await POST(post({ url: 'https://example.com/whatever' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_input');
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-JSON body', async () => {
    stubUniqlo({});
    const res = await POST(new Request('http://localhost/api/product', { method: 'POST', body: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('reports unknown products as 404', async () => {
    stubUniqlo({ details: { status: 404 } });
    const res = await POST(post({ url: 'E100004-000' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('does not remember transient failures, so a retry can succeed', async () => {
    stubUniqlo({ details: 'network', sizeCharts: 'network' });
    expect((await POST(post({ url: 'E100007-000' }))).status).toBe(502);
    stubUniqlo({ details: details('Crew Neck T-Shirt', ['T-Shirts', 'T-Shirts']), sizeCharts: sizeCharts('E100007-000') });
    expect((await POST(post({ url: 'E100007-000' }))).status).toBe(200);
  });

  it('remembers permanent failures (404) for a minute without calling UNIQLO again', async () => {
    stubUniqlo({ details: { status: 404 } });
    expect((await POST(post({ url: 'E100008-000' }))).status).toBe(404);
    const calls = stubUniqlo({ details: details('Crew Neck T-Shirt', ['T-Shirts', 'T-Shirts']) });
    expect((await POST(post({ url: 'E100008-000' }))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('treats "no size chart" (404) as a real answer and caches the item', async () => {
    stubUniqlo({ details: details('Crew Neck T-Shirt', ['T-Shirts', 'T-Shirts']), sizeCharts: { status: 404 } });
    expect((await (await POST(post({ url: 'E100009-000' }))).json()).sizeChart).toBeNull();
    const calls = stubUniqlo({});
    expect((await POST(post({ url: 'E100009-000' }))).status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('rate-limits one IP with a JSON 429', async () => {
    stubUniqlo({});
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await POST(post({ url: 'nope' }, '203.0.113.9'))).status);
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    const limited = await POST(post({ url: 'nope' }, '203.0.113.9'));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect((await POST(post({ url: 'nope' }, '203.0.113.10'))).status).toBe(400);
  });

  it('reports an unreachable UNIQLO as 502 "blocked" so the app offers the paste-JSON fallback', async () => {
    stubUniqlo({ details: 'network', sizeCharts: 'network' });
    const res = await POST(post({ url: 'E100005-000' }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('blocked');
  });
});
