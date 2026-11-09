import { afterEach, describe, expect, it } from 'vitest';
import { parseLookRequest, parsePieces, type BodySpec, type LookPiece } from './look';
import { angleAllowed, issueLookToken, lookDigest, MAX_ATTEMPTS, recordAngle, TOKEN_TTL_MS, verifyLookToken } from './lookToken';
import { buildLookPrompt, describeImages, describePiece } from './photorealPrompt';
import {
  begin,
  check,
  COOKIE_NAME,
  currentUsage,
  decodeCount,
  encodeCount,
  end,
  IP_CONCURRENCY,
  LOOK_LIMIT,
  lookCookie,
  looksLeft,
  readCookie,
} from './rateLimit';

const SECRET = 'test-secret';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const BODY: BodySpec = { heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84 };
const TOP: LookPiece = { slot: 'top', name: 'Washable Milano Ribbed Sweater', color: 'Blue', fabric: 'rib knit', size: 'S', ease: 'regular', length: 'regular' };
const BOTTOM: LookPiece = { slot: 'bottom', name: 'Ultra Stretch Pants', color: 'Black', fabric: 'twill', size: 'S', ease: 'regular', length: 'ankle' };
const req = (ip: string, cookie?: string) =>
  new Request('http://x', { headers: { 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) } });
const validBody = (extra: Record<string, unknown> = {}) => ({
  view: 'front',
  scene: 'studio',
  body: BODY,
  items: [TOP, BOTTOM],
  photos: { front: PHOTO, side: PHOTO, face: PHOTO },
  ...extra,
});

describe('look request', () => {
  it('accepts a complete front request', () => {
    const out = parseLookRequest(validBody());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toMatchObject({ view: 'front', scene: 'studio', items: [{ slot: 'top' }, { slot: 'bottom' }] });
  });

  it('needs all three photos, as image data URLs', () => {
    const missing = parseLookRequest(validBody({ photos: { front: PHOTO, side: PHOTO } }));
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/three photos/) });
    const remote = parseLookRequest(validBody({ photos: { front: 'https://example.com/a.jpg', side: PHOTO, face: PHOTO } }));
    expect(remote.ok).toBe(false);
  });

  it('needs a plausible body', () => {
    expect(parseLookRequest(validBody({ body: { ...BODY, heightCm: 20 } })).ok).toBe(false);
    expect(parseLookRequest(validBody({ body: { heightCm: 178 } })).ok).toBe(false);
  });

  it('needs the front shot and its token for the other angles', () => {
    expect(parseLookRequest(validBody({ view: 'back' })).ok).toBe(false);
    expect(parseLookRequest(validBody({ view: 'back', reference: PHOTO })).ok).toBe(false);
    const ok = parseLookRequest(validBody({ view: 'back', reference: PHOTO, lookToken: 'a.b.c' }));
    expect(ok).toMatchObject({ ok: true, value: { view: 'back', reference: PHOTO, lookToken: 'a.b.c' } });
  });

  it('rejects unknown views and falls back to the studio scene', () => {
    expect(parseLookRequest(validBody({ view: 'top-down' })).ok).toBe(false);
    const out = parseLookRequest(validBody({ scene: 'mars' }));
    expect(out.ok && out.value.scene).toBe('studio');
  });

  it('sanitises pieces, keeps one per slot and only UNIQLO product photos', () => {
    const pieces = parsePieces([
      { slot: 'bottom', name: 'Barrel Jeans<script>', color: 'Blue', fabric: 'denim', ease: 'huge', image: 'https://evil.example/x.jpg' },
      { slot: 'top', name: 'Crew Neck T-Shirt', color: 'White', fabric: 'jersey', size: 'M', image: 'https://image.uniqlo.com/UQ/ST3/us/imagesgoods/422992/item/usgoods_00_422992_3x4.jpg' },
      { slot: 'top', name: 'Second top', color: 'Red', fabric: '' },
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ slot: 'top', size: 'M', image: expect.stringContaining('image.uniqlo.com') });
    expect(pieces[1]).toEqual({ slot: 'bottom', name: 'Barrel Jeansscript', color: 'Blue', fabric: 'denim' });
    expect(parsePieces('nope')).toEqual([]);
  });
});

describe('look prompt', () => {
  it('numbers the reference images in the order they are attached', () => {
    expect(describeImages({ reference: false, products: ['top'] })).toEqual([
      'Image 1: the person, front view, full body.',
      'Image 2: the same person, side view, full body.',
      "Image 3: the same person's face in left profile, close-up.",
      'Image 4: product photo of the top to wear.',
    ]);
    const withRef = describeImages({ reference: true, products: ['top', 'bottom'] });
    expect(withRef[3]).toMatch(/^Image 4: the finished front photo of this exact look/);
    expect(withRef[5]).toBe('Image 6: product photo of the bottoms to wear.');
  });

  it('describes each piece with its size and how it fits this body', () => {
    expect(describePiece(TOP)).toBe(
      'Top: UNIQLO "Washable Milano Ribbed Sweater" in Blue, rib knit, size S. On this body: a regular fit with a little room through the chest and waist; the hem sits at the hip. Worn untucked.',
    );
    expect(describePiece(BOTTOM)).toContain('ankle-length');
    expect(describePiece({ slot: 'bottom', name: 'Pants', color: 'Navy', fabric: '' })).toBe('Bottoms: UNIQLO "Pants" in Navy.');
  });

  it('carries the view, the body numbers, the setting and the guard rails', () => {
    const p = buildLookPrompt({ view: 'side', scene: 'night', body: BODY, items: [TOP, BOTTOM], roles: { reference: true, products: ['top', 'bottom'] } });
    expect(p).toContain("left side toward the camera");
    expect(p).toContain('178 cm (5\'10") tall and weigh 65 kg (143 lb)');
    expect(p).toContain('chest 92 cm, waist 75 cm, hips 90 cm, inseam 84 cm');
    expect(p).toContain('Do not make them slimmer');
    expect(p).toContain('at night');
    expect(p).toContain('exactly as in its product photo');
    expect(p).toContain('No logos, no text');
  });

  it('describes garments in words when no product photo came through', () => {
    const p = buildLookPrompt({ view: 'front', scene: 'studio', body: BODY, items: [TOP], roles: { reference: false, products: [] } });
    expect(p).not.toContain('Image 4');
    expect(p).not.toContain('its product photo');
    expect(p).toContain('Reproduce each garment faithfully');
    expect(p).toContain('product page');
  });
});

describe('rate limit cookie', () => {
  it('round-trips a signed count', () => {
    expect(decodeCount(encodeCount(2, SECRET), SECRET)).toBe(2);
  });
  it('rejects tampered or foreign cookies', () => {
    const [, sig] = encodeCount(2, SECRET).split('.');
    expect(decodeCount(`0.${sig}`, SECRET)).toBe(0);
    expect(decodeCount(encodeCount(2, 'other'), SECRET)).toBe(0);
    expect(decodeCount('garbage', SECRET)).toBe(0);
    expect(decodeCount(undefined, SECRET)).toBe(0);
  });
  it('reads a cookie from the header', () => {
    expect(readCookie(`a=1; ${COOKIE_NAME}=2.x; b=3`, COOKIE_NAME)).toBe('2.x');
    expect(readCookie(null, COOKIE_NAME)).toBeUndefined();
  });
  it('charges one look in an HttpOnly cookie', () => {
    const cookie = lookCookie(currentUsage(req('8.8.8.8'), SECRET), SECRET);
    expect(cookie).toContain('HttpOnly');
    expect(decodeCount(cookie.split(';')[0].split('=')[1], SECRET)).toBe(1);
  });
});

describe('rate limit policy', () => {
  afterEach(() => {
    delete process.env.PHOTOREAL_DISABLED;
  });

  it('stops new looks at the limit but lets the angles of a started look finish', () => {
    const usage = currentUsage(req('9.9.9.1', `${COOKIE_NAME}=${encodeCount(LOOK_LIMIT, SECRET)}`), SECRET);
    expect(check(usage, true)).toMatchObject({ ok: false, status: 429 });
    expect(check(usage, false)).toEqual({ ok: true });
    expect(looksLeft(usage)).toBe(0);
  });

  it('caps concurrent generations per IP', () => {
    const usage = currentUsage(req('5.5.5.5'), SECRET);
    for (let i = 0; i < IP_CONCURRENCY; i += 1) begin(usage.ip);
    expect(check(usage, false)).toMatchObject({ ok: false, status: 429 });
    end(usage.ip);
    expect(check(usage, false)).toEqual({ ok: true });
    for (let i = 1; i < IP_CONCURRENCY; i += 1) end(usage.ip);
  });

  it('honours the kill switch', () => {
    process.env.PHOTOREAL_DISABLED = '1';
    expect(check(currentUsage(req('7.7.7.7'), SECRET), true)).toMatchObject({ ok: false, status: 503 });
  });
});

describe('look token', () => {
  const look = { scene: 'studio' as const, body: BODY, items: [TOP, BOTTOM], photos: { front: PHOTO, side: PHOTO, face: PHOTO } };
  const DIGEST = lookDigest(look);

  it('verifies its own tokens until they expire', () => {
    const now = 1_000_000;
    const token = issueLookToken(SECRET, DIGEST, now);
    const id = verifyLookToken(token, SECRET, DIGEST, now + 1000);
    expect(id).toMatch(/^[\w-]+$/);
    expect(verifyLookToken(token, SECRET, DIGEST, now + TOKEN_TTL_MS + 1)).toBeNull();
    expect(verifyLookToken(token, 'other', DIGEST, now)).toBeNull();
    expect(verifyLookToken(token.replace(/\.\d+\./, `.${now + 10 * TOKEN_TTL_MS}.`), SECRET, DIGEST, now)).toBeNull();
    expect(verifyLookToken(undefined, SECRET, DIGEST)).toBeNull();
  });

  it('only works for the look it was issued for', () => {
    const token = issueLookToken(SECRET, DIGEST);
    expect(verifyLookToken(token, SECRET, lookDigest({ ...look, items: [{ ...TOP, size: 'XL' }, BOTTOM] }))).toBeNull();
    expect(verifyLookToken(token, SECRET, lookDigest({ ...look, photos: { ...look.photos, face: 'data:image/jpeg;base64,AAAA' } }))).toBeNull();
    expect(verifyLookToken(token, SECRET, lookDigest({ ...look }))).not.toBeNull();
  });

  it('lets each angle succeed once and caps billed failures', () => {
    const id = verifyLookToken(issueLookToken(SECRET, DIGEST), SECRET, DIGEST)!;
    expect(angleAllowed(id, 'back')).toEqual({ ok: true });
    recordAngle(id, 'back', true);
    expect(angleAllowed(id, 'back')).toMatchObject({ ok: false, status: 409 });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordAngle(id, 'side', false);
    expect(angleAllowed(id, 'side')).toMatchObject({ ok: false, status: 429 });
    expect(angleAllowed(id, 'three_quarter')).toEqual({ ok: true });
  });
});
