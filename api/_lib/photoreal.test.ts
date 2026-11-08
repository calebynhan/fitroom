import { describe, expect, it } from 'vitest';
import { buildPrompt, isScene, parseOutfit } from './photorealPrompt';
import { COOKIE_NAME, currentUsage, decodeCount, encodeCount, readCookie, recordUse } from './rateLimit';

const SECRET = 'test-secret';

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
  it('counts per visitor across cookie and IP', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const first = currentUsage(req, SECRET);
    expect(first.used).toBe(0);
    const cookie = recordUse(first, SECRET);
    expect(cookie).toContain('HttpOnly');
    // Same IP without the cookie still counts.
    expect(currentUsage(req, SECRET).used).toBe(1);
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
