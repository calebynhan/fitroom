import { afterEach, describe, expect, it } from 'vitest';
import { comparedItems, parseLookRequest, parsePieces, type BodySpec, type LookPiece } from './look';
import { claimAngle, issueLookToken, lookDigest, MAX_ATTEMPTS, MAX_COMPARES, settleAngle, shotKey, TOKEN_TTL_MS, verifyLookToken } from './lookToken';
import { buildLookPrompt, describeDelta, describeImages, describePiece } from './photorealPrompt';
import {
  begin,
  check,
  COOKIE_NAME,
  currentUsage,
  decodeCount,
  encodeCount,
  end,
  IP_CONCURRENCY,
  IP_IMAGE_CEILING,
  LOOK_LIMIT,
  lookCookie,
  looksLeft,
  readCookie,
  recordImage,
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

describe('size comparison request', () => {
  const compareBody = (compare: unknown, extra: Record<string, unknown> = {}) =>
    validBody({ reference: PHOTO, lookToken: 'a.1.b', compare, ...extra });

  it('accepts one worn slot in another size, with its fit and the chart differences', () => {
    const parsed = parseLookRequest(compareBody({ slot: 'top', size: 'M', ease: 'relaxed', length: 'long', delta: { chestCm: 6, lengthCm: 3, bogus: 9 } }));
    expect(parsed.ok && parsed.value.compare).toEqual({ slot: 'top', size: 'M', ease: 'relaxed', length: 'long', delta: { chestCm: 6, lengthCm: 3 } });
    expect(parsed.ok && parsed.value.lookToken).toBe('a.1.b');
  });

  it('needs the finished front shot and its token, on the front view', () => {
    expect(parseLookRequest(validBody({ compare: { slot: 'top', size: 'M' } }))).toMatchObject({ ok: false, error: expect.stringMatching(/front shot/) });
    expect(parseLookRequest(compareBody({ slot: 'top', size: 'M' }, { view: 'back' }))).toMatchObject({ ok: false, error: expect.stringMatching(/front view/) });
  });

  it('refuses the size already shot, an unworn slot and wild numbers', () => {
    expect(parseLookRequest(compareBody({ slot: 'top', size: 'S' }))).toMatchObject({ ok: false, error: expect.stringMatching(/already shows size S/) });
    expect(parseLookRequest(compareBody({ slot: 'top', size: 'M' }, { items: [BOTTOM] }))).toMatchObject({ ok: false });
    expect(parseLookRequest(compareBody({ slot: 'hat', size: 'M' }))).toMatchObject({ ok: false });
    const wild = parseLookRequest(compareBody({ slot: 'bottom', size: 'M', ease: 'huge', delta: { hipsCm: 400, inseamCm: '2' } }));
    expect(wild.ok && wild.value.compare).toEqual({ slot: 'bottom', size: 'M' });
  });

  it('swaps only the compared piece into its new size', () => {
    const items = comparedItems([TOP, BOTTOM], { slot: 'top', size: 'M', ease: 'relaxed' });
    expect(items[0]).toEqual({ ...TOP, size: 'M', ease: 'relaxed', length: undefined });
    expect('length' in items[0]).toBe(false);
    expect(items[1]).toBe(BOTTOM);
    expect(comparedItems([TOP], undefined)).toEqual([TOP]);
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

  it('puts the photo to edit first for a size comparison and states the chart difference', () => {
    const compare = { slot: 'top' as const, from: 'S', to: 'M', delta: { chestCm: 6, lengthCm: 3 } };
    const lines = describeImages({ reference: true, products: ['top'], compare });
    expect(lines[0]).toBe('Image 1: the finished front photo of this look, with the top in size S; this is the photo to edit.');
    expect(lines[1]).toBe('Image 2: the person, front view, full body.');
    expect(lines[4]).toBe('Image 5: product photo of the top to wear.');

    const prompt = buildLookPrompt({ view: 'front', scene: 'studio', body: BODY, items: comparedItems([TOP, BOTTOM], { slot: 'top', size: 'M' }), roles: { reference: true, products: ['top'], compare } });
    expect(prompt).toContain('Edit Image 1.');
    expect(prompt).toContain('Change only the top: it is now size M instead of size S');
    expect(prompt).toContain('size M measures 6 cm more around the chest, 3 cm longer than size S');
    expect(prompt).toContain('Ignore the clothes they wear in Images 2-4.');
    expect(prompt).toContain('size M.');
  });

  it('words chart differences both ways and skips the negligible ones', () => {
    expect(describeDelta({ hipsCm: -6, inseamCm: -2, lengthCm: 0.2 })).toBe('6 cm less around the hips, 2 cm shorter in the leg');
    expect(describeDelta({ lengthCm: 0.3 })).toBeNull();
    expect(describeDelta(undefined)).toBeNull();
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

  it('needs room for a whole look before charging the front', () => {
    const usage = currentUsage(req('6.6.6.6'), SECRET);
    for (let i = 0; i < IP_IMAGE_CEILING - 3; i += 1) recordImage(usage.ip);
    expect(check(usage, true)).toMatchObject({ ok: false, status: 429, retryable: false });
    expect(check(usage, false)).toEqual({ ok: true }); // the angles of a started look can still finish
  });

  it('caps concurrent generations per IP, and says a retry will help', () => {
    const usage = currentUsage(req('5.5.5.5'), SECRET);
    for (let i = 0; i < IP_CONCURRENCY; i += 1) begin(usage.ip);
    expect(check(usage, false)).toMatchObject({ ok: false, status: 429, retryable: true, retryAfterS: 5 });
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

  it('lets each angle succeed once, refuses duplicates in flight, and caps billed failures', () => {
    const id = verifyLookToken(issueLookToken(SECRET, DIGEST), SECRET, DIGEST)!;
    expect(claimAngle(id, 'back')).toEqual({ ok: true });
    expect(claimAngle(id, 'back')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/developing/) });
    settleAngle(id, 'back', 'done');
    expect(claimAngle(id, 'back')).toMatchObject({ ok: false, status: 409, retryable: false });

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect(claimAngle(id, 'side')).toEqual({ ok: true });
      settleAngle(id, 'side', 'billed');
    }
    expect(claimAngle(id, 'side')).toMatchObject({ ok: false, status: 429 });

    expect(claimAngle(id, 'three_quarter')).toEqual({ ok: true });
    settleAngle(id, 'three_quarter', 'free'); // a failure that cost nothing frees the angle for a retry
    expect(claimAngle(id, 'three_quarter')).toEqual({ ok: true });
  });

  it(`allows ${MAX_COMPARES} size comparisons per look, each once`, () => {
    const id = verifyLookToken(issueLookToken(SECRET, DIGEST), SECRET, DIGEST)!;
    const top = shotKey('front', { slot: 'top', size: 'M' });
    expect(top).toBe('compare:top:M');
    expect(shotKey('back')).toBe('back');

    expect(claimAngle(id, top)).toEqual({ ok: true });
    settleAngle(id, top, 'done');
    expect(claimAngle(id, top)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/size comparison was already made/) });

    const free = shotKey('front', { slot: 'bottom', size: 'XS' });
    expect(claimAngle(id, free)).toEqual({ ok: true });
    settleAngle(id, free, 'free'); // cost nothing: does not use up a comparison
    expect(claimAngle(id, shotKey('front', { slot: 'bottom', size: 'M' }))).toEqual({ ok: true });
    expect(claimAngle(id, shotKey('front', { slot: 'bottom', size: 'L' }))).toMatchObject({ ok: false, status: 429, error: expect.stringMatching(/compare 2 sizes/) });
    expect(claimAngle(id, 'side')).toEqual({ ok: true }); // the angles are counted separately
  });
});
