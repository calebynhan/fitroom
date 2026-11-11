import { describe, expect, it } from 'vitest';
import { memoryStore, upstashStore } from './store';

describe('memory store', () => {
  it('counts, hashes and distinct-counts, and forgets after the TTL', async () => {
    let t = 0;
    const store = memoryStore(() => t);
    expect(await store.incr('c', 2, 10)).toBe(2);
    expect(await store.hincr('h', 'a', 1, 10)).toBe(1);
    expect(await store.hincr('h', 'a', 2, 10)).toBe(3);
    expect(await store.hgetall('h')).toEqual({ a: 3 });
    await store.pfadd('u1', 'x', 10);
    await store.pfadd('u1', 'x', 10);
    await store.pfadd('u2', 'y', 10);
    expect(await store.pfcount(['u1'])).toBe(1);
    expect(await store.pfcount(['u1', 'u2'])).toBe(2);
    t = 11_000;
    expect(await store.incr('c', 1, 10)).toBe(1);
    expect(await store.hgetall('h')).toEqual({});
    expect(await store.pfcount(['u1', 'u2'])).toBe(0);
  });
});

describe('Upstash store', () => {
  function fake(replies: unknown[]) {
    const sent: unknown[] = [];
    const store = upstashStore('https://x.upstash.io/', 'tok', async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json(replies.shift());
    });
    return { store, sent };
  }

  it('sends one pipeline per operation and reads the replies', async () => {
    const { store, sent } = fake([
      [{ result: 4 }, { result: 1 }],
      [{ result: ['S|too_small', '2', 'S|just_right', '3'] }],
      [{ result: 1 }, { result: 1 }],
      [{ result: 7 }],
    ]);
    expect(await store.hincr('fr:fit:E1', 'S|too_small', 1, 60)).toBe(4);
    expect(await store.hgetall('fr:fit:E1')).toEqual({ 'S|too_small': 2, 'S|just_right': 3 });
    await store.pfadd('fr:u:2026-11-11', 'u:abc', 60);
    expect(await store.pfcount(['fr:u:2026-11-11', 'fr:u:2026-11-10'])).toBe(7);
    expect(sent).toEqual([
      [['HINCRBY', 'fr:fit:E1', 'S|too_small', '1'], ['EXPIRE', 'fr:fit:E1', '60']],
      [['HGETALL', 'fr:fit:E1']],
      [['PFADD', 'fr:u:2026-11-11', 'u:abc'], ['EXPIRE', 'fr:u:2026-11-11', '60']],
      [['PFCOUNT', 'fr:u:2026-11-11', 'fr:u:2026-11-10']],
    ]);
  });

  it('throws on an error reply so callers can fail closed', async () => {
    const { store } = fake([[{ error: 'WRONGTYPE' }]]);
    await expect(store.hgetall('k')).rejects.toThrow('WRONGTYPE');
  });
});
