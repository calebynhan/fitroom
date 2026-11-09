import { describe, expect, it } from 'vitest';
import { createWindowLimiter } from './windowLimit';

describe('createWindowLimiter', () => {
  it('allows `limit` hits per key per window, then says when to retry', () => {
    const limiter = createWindowLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.hit('a', 0)).toEqual({ ok: true });
    expect(limiter.hit('a', 1_000)).toEqual({ ok: true });
    expect(limiter.hit('a', 2_000)).toEqual({ ok: false, retryAfterS: 58 });
    expect(limiter.hit('b', 2_000)).toEqual({ ok: true });
  });
  it('starts a fresh window once the old one has passed', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('a', 999).ok).toBe(false);
    expect(limiter.hit('a', 1_000).ok).toBe(true);
  });
  it('forgets everyone rather than growing without bound', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    limiter.hit('a', 0);
    limiter.hit('b', 0);
    limiter.hit('c', 0); // over maxKeys: table resets
    expect(limiter.hit('a', 1).ok).toBe(true);
  });
});
