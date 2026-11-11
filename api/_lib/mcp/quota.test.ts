import { describe, expect, it } from 'vitest';
import { limitsFromEnv, memoryStore, reserve, upstashStore, userKey, type QuotaStore } from './quota';

const NOV_11 = Date.UTC(2026, 10, 11, 12);

describe('free try-on quota', () => {
  it('allows the monthly free photos, then refuses until the 1st; a release gives one back', async () => {
    const store = memoryStore(() => NOV_11);
    const limits = { perMonth: 2, perDay: 100 };
    const a = await reserve(store, 'u:a', limits, NOV_11);
    expect(a).toMatchObject({ ok: true, used: 1, remaining: 1, resetsAt: '2026-12-01T00:00:00.000Z' });
    expect((await reserve(store, 'u:a', limits, NOV_11)).ok).toBe(true);
    expect(await reserve(store, 'u:a', limits, NOV_11)).toMatchObject({ ok: false, reason: 'user', remaining: 0 });
    if (a.ok) await a.release();
    expect((await reserve(store, 'u:a', limits, NOV_11)).ok).toBe(true);
    // next month starts fresh
    expect((await reserve(store, 'u:a', limits, Date.UTC(2026, 11, 1, 0, 1))).ok).toBe(true);
  });

  it('stops everyone at the daily cap without spending the person\'s photo', async () => {
    const store = memoryStore(() => NOV_11);
    const limits = { perMonth: 5, perDay: 1 };
    expect((await reserve(store, 'u:a', limits, NOV_11)).ok).toBe(true);
    expect(await reserve(store, 'u:b', limits, NOV_11)).toMatchObject({ ok: false, reason: 'everyone', remaining: 5 });
  });

  it('fails closed when the store is down', async () => {
    const broken: QuotaStore = { incr: async () => { throw new Error('down'); } };
    expect(await reserve(broken, 'u:a', { perMonth: 5, perDay: 100 }, NOV_11)).toMatchObject({ ok: false, reason: 'store' });
  });

  it('keys people by hashed ChatGPT subject, then conversation, then IP', () => {
    const subject = userKey({ 'openai/subject': 'v1/abc', 'openai/session': 's1' }, '1.2.3.4');
    expect(subject).toMatch(/^u:[\w-]{22}$/);
    expect(subject).not.toContain('abc');
    expect(userKey({ 'openai/session': 's1' }, '1.2.3.4')).toMatch(/^s:/);
    expect(userKey(undefined, '1.2.3.4')).toMatch(/^ip:/);
    expect(userKey({ 'openai/subject': 'v1/abc' }, '9.9.9.9')).toBe(subject);
  });

  it('reads limits from the environment', () => {
    expect(limitsFromEnv({})).toEqual({ perMonth: 5, perDay: 100 });
    expect(limitsFromEnv({ TRYON_FREE_PER_MONTH: '3', TRYON_DAILY_CAP: '40' })).toEqual({ perMonth: 3, perDay: 40 });
    expect(limitsFromEnv({ TRYON_FREE_PER_MONTH: 'lots' }).perMonth).toBe(5);
  });

  it('talks to Upstash with one pipeline per count', async () => {
    const sent: { url: string; body: unknown; auth: string | null }[] = [];
    const store = upstashStore('https://eu1-x.upstash.io/', 'tok', async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return Response.json([{ result: 3 }, { result: 1 }]);
    });
    expect(await store.incr('k', 1, 60)).toBe(3);
    expect(sent[0]).toEqual({ url: 'https://eu1-x.upstash.io/pipeline', body: [['INCRBY', 'k', '1'], ['EXPIRE', 'k', '60']], auth: 'Bearer tok' });
    const failing = upstashStore('https://x.upstash.io', 'tok', async () => new Response('no', { status: 500 }));
    await expect(failing.incr('k', 1, 60)).rejects.toThrow();
  });
});
