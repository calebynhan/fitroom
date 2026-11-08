import { afterEach, describe, expect, it } from 'vitest';
import { buildPrompt, isScene, parseOutfit } from './photorealPrompt';
import {
  begin,
  check,
  COOKIE_NAME,
  currentUsage,
  decodeCount,
  encodeCount,
  end,
  IP_CONCURRENCY,
  PHOTOREAL_LIMIT,
  readCookie,
  recordUse,
} from './rateLimit';

const SECRET = 'test-secret';
const req = (ip: string, cookie?: string) =>
  new Request('http://x', { headers: { 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) } });

describe('rate limit cookie', () => {
  it('round-trips a signed count', () => {
    expect(decodeCount(encodeCount(3, SECRET), SECRET)).toBe(3);
  });
  it('rejects tampered or foreign cookies', () => {
    const [, sig] = encodeCount(3, SECRET).split('.');
    expect(decodeCount(`0.${sig}`, SECRET)).toBe(0);
    expect(decodeCount(encodeCount(3, 'other'), SECRET)).toBe(0);
    expect(decodeCount('garbage', SECRET)).toBe(0);
    expect(decodeCount(undefined, SECRET)).toBe(0);
  });
  it('reads a cookie from the header', () => {
    expect(readCookie('a=1; fr_pr=2.x; b=3', COOKIE_NAME)).toBe('2.x');
    expect(readCookie(null, COOKIE_NAME)).toBeUndefined();
  });
});

describe('rate limit policy', () => {
  afterEach(() => {
    delete process.env.PHOTOREAL_DISABLED;
  });

  it('limits each visitor by their signed cookie', () => {
    const atLimit = req('9.9.9.1', `${COOKIE_NAME}=${encodeCount(PHOTOREAL_LIMIT, SECRET)}`);
    expect(check(currentUsage(atLimit, SECRET))).toMatchObject({ ok: false, status: 429 });
  });

  it('does not lock out other visitors on the same IP', () => {
    const first = currentUsage(req('1.2.3.4'), SECRET);
    for (let i = 0; i < PHOTOREAL_LIMIT; i += 1) recordUse({ ...first, used: i }, SECRET);
    expect(check(currentUsage(req('1.2.3.4'), SECRET))).toEqual({ ok: true });
  });

  it('caps concurrent generations per IP', () => {
    const usage = currentUsage(req('5.5.5.5'), SECRET);
    for (let i = 0; i < IP_CONCURRENCY; i += 1) begin(usage.ip);
    expect(check(usage)).toMatchObject({ ok: false, status: 429 });
    end(usage.ip);
    expect(check(usage)).toEqual({ ok: true });
  });

  it('honours the kill switch', () => {
    process.env.PHOTOREAL_DISABLED = '1';
    expect(check(currentUsage(req('7.7.7.7'), SECRET))).toMatchObject({ ok: false, status: 503 });
  });

  it('sets an HttpOnly cookie with the next count', () => {
    const cookie = recordUse(currentUsage(req('8.8.8.8'), SECRET), SECRET);
    expect(cookie).toContain('HttpOnly');
    expect(decodeCount(cookie.split(';')[0].split('=')[1], SECRET)).toBe(1);
  });
});

describe('photoreal prompt', () => {
  it('validates scenes', () => {
    expect(isScene('city')).toBe(true);
    expect(isScene('mars')).toBe(false);
  });
  it('sanitises and caps the outfit', () => {
    const out = parseOutfit([
      { name: 'Cashmere Sweater', color: 'Navy', fabric: 'cashmere' },
      { name: 'Barrel Jeans<script>', color: 'Blue', fabric: 'denim' },
      { name: 'Extra', color: 'Red', fabric: '' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe('Barrel Jeansscript');
    expect(parseOutfit('nope')).toEqual([]);
  });
  it('mentions the garments and the setting', () => {
    const p = buildPrompt('night', [{ name: 'Crew Neck T-Shirt', color: 'White', fabric: 'jersey' }]);
    expect(p).toContain('a white Crew Neck T-Shirt (jersey)');
    expect(p).toContain('at night');
    expect(p).toContain('No logos, no text');
  });
});
