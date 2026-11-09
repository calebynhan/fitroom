import { describe, expect, it, vi } from 'vitest';
import { fetchDetails, fetchListing, fetchSizeCharts, sizeChartsApiUrl } from './uniqloClient';

type Reply = { status?: number; body?: unknown } | Error;

/** A fetch stand-in that answers each call with the next reply and records the URLs. */
function fakeFetch(replies: Reply[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected extra fetch');
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const NO_WAIT = { retryDelayMs: 0 };

describe('fetchDetails', () => {
  it('returns the result object', async () => {
    const { impl, calls } = fakeFetch([{ body: { status: 'ok', result: { name: 'Tee' } } }]);
    const out = await fetchDetails('E455365-000', { fetchImpl: impl });
    expect(out).toEqual({ ok: true, data: { name: 'Tee' } });
    expect(calls[0]).toContain('/products/E455365-000/price-groups/00/details');
  });
  it('maps 404 and "nok" bodies to not-found without retrying', async () => {
    const a = fakeFetch([{ status: 404 }]);
    expect(await fetchDetails('E1', { fetchImpl: a.impl, retries: 2, ...NO_WAIT })).toMatchObject({ ok: false, status: 404 });
    expect(a.calls).toHaveLength(1);
    const b = fakeFetch([{ body: { status: 'nok', error: {} } }]);
    expect(await fetchDetails('E1', { fetchImpl: b.impl })).toMatchObject({ ok: false, status: 404 });
  });
  it('retries network errors and 5xx, then succeeds', async () => {
    const { impl, calls } = fakeFetch([new TypeError('fetch failed'), { status: 503 }, { body: { status: 'ok', result: {} } }]);
    const out = await fetchDetails('E1', { fetchImpl: impl, retries: 2, ...NO_WAIT });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });
  it('gives up after the retry budget with the last failure', async () => {
    const { impl } = fakeFetch([{ status: 503 }, { status: 503 }]);
    expect(await fetchDetails('E1', { fetchImpl: impl, retries: 1, ...NO_WAIT })).toEqual({
      ok: false,
      status: 503,
      reason: 'UNIQLO answered 503',
    });
  });
  it('rejects "ok" bodies whose result is not an object', async () => {
    const a = fakeFetch([{ body: { status: 'ok', result: null } }]);
    expect(await fetchDetails('E1', { fetchImpl: a.impl })).toMatchObject({ ok: false, status: 502 });
    const b = fakeFetch([{ body: { status: 'ok', result: 'text' } }]);
    expect(await fetchDetails('E1', { fetchImpl: b.impl })).toMatchObject({ ok: false, status: 502 });
  });
  it('reports non-JSON bodies as failures instead of throwing', async () => {
    const impl = vi.fn(async () => new Response('<html>blocked</html>', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchDetails('E1', { fetchImpl: impl })).toMatchObject({ ok: false, status: 502 });
  });
});

describe('fetchSizeCharts', () => {
  it('batches IDs and keys entries by productId', async () => {
    const { impl, calls } = fakeFetch([
      { body: { status: 'ok', result: [{ productId: 'E1', sizeChart: [] }, { productId: 'E2', sizeChart: [] }] } },
      { body: { status: 'ok', result: [{ productId: 'E3', sizeChart: [] }] } },
    ]);
    const out = await fetchSizeCharts(['E1', 'E2', 'E3'], { fetchImpl: impl, batchSize: 2 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([...out.data.keys()]).toEqual(['E1', 'E2', 'E3']);
    expect(calls[0]).toBe(sizeChartsApiUrl(['E1', 'E2']));
    expect(calls[1]).toBe(sizeChartsApiUrl(['E3']));
  });
  it('fails the whole call if any batch fails, so callers can fall back to null charts', async () => {
    const { impl } = fakeFetch([{ body: { status: 'ok', result: [] } }, { status: 500 }]);
    const out = await fetchSizeCharts(['E1', 'E2'], { fetchImpl: impl, batchSize: 1, ...NO_WAIT });
    expect(out.ok).toBe(false);
  });
  it('skips the network for an empty list', async () => {
    const { impl, calls } = fakeFetch([]);
    expect(await fetchSizeCharts([], { fetchImpl: impl })).toEqual({ ok: true, data: new Map() });
    expect(calls).toHaveLength(0);
  });
});

describe('fetchListing', () => {
  it('pages until it has every item', async () => {
    const page = (ids: string[], total: number) => ({
      body: { status: 'ok', result: { items: ids.map((productId) => ({ productId })), pagination: { total } } },
    });
    const { impl, calls } = fakeFetch([page(['E1', 'E2'], 3), page(['E3'], 3)]);
    const out = await fetchListing('22211,95668,95670,', { fetchImpl: impl, pageSize: 2 });
    expect(out).toEqual({ ok: true, data: [{ productId: 'E1' }, { productId: 'E2' }, { productId: 'E3' }] });
    expect(calls[0]).toContain('path=22211%2C95668%2C95670%2C');
    expect(calls[0]).toContain('offset=0&limit=2');
    expect(calls[1]).toContain('offset=2&limit=2');
  });
  it('stops on an empty page even if total says otherwise', async () => {
    const { impl } = fakeFetch([{ body: { status: 'ok', result: { items: [], pagination: { total: 50 } } } }]);
    expect(await fetchListing('22211,,,', { fetchImpl: impl })).toEqual({ ok: true, data: [] });
  });
});
