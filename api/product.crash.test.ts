import { describe, expect, it, vi } from 'vitest';

// An unexpected throw inside the lookup must still reach the app as JSON, not Vercel's HTML 500 page.
vi.mock('./_lib/uniqloClient', () => ({
  fetchDetails: () => Promise.reject(new Error('boom')),
  fetchSizeCharts: () => Promise.reject(new Error('boom')),
}));

describe('POST /api/product when something unexpected throws', () => {
  it('answers 500 with a JSON error and does not cache it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { POST } = await import('./product');
    const request = () =>
      new Request('http://localhost/api/product', { method: 'POST', body: JSON.stringify({ url: 'E100100-000' }) });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong loading that product. Try again.', code: 'internal' });
    expect((await POST(request())).status).toBe(500);
  });
});
