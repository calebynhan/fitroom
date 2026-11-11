import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './photoreal';
import { ledger, resetLedger } from './_lib/ledger';
import { COOKIE_NAME, decodeCount, encodeCount, LOOK_LIMIT } from './_lib/rateLimit';
import { encodeSession, SESSION_COOKIE } from './_lib/session';

const KEY = 'sk-test-key';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const PRODUCT_URL = 'https://image.uniqlo.com/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg';
const BODY = { heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84 };

let ipSeq = 0;
function call(body: Record<string, unknown>, cookie?: string): Promise<Response> {
  ipSeq += 1;
  return POST(
    new Request('http://x/api/photoreal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ipSeq}`, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

const look = (extra: Record<string, unknown> = {}) => ({
  view: 'front',
  scene: 'studio',
  body: BODY,
  items: [
    { slot: 'top', name: 'Washable Milano Ribbed Sweater', color: 'Blue', fabric: 'rib_knit', size: 'S', image: PRODUCT_URL },
    { slot: 'bottom', name: 'Ultra Stretch Pants', color: 'Black', fabric: 'twill', size: 'S' },
  ],
  photos: { front: PHOTO, side: PHOTO, face: PHOTO },
  ...extra,
});

interface Captured {
  form: FormData | null;
  productFetches: string[];
}

function mockUpstream(openai: () => Response, captured: Captured) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://image.uniqlo.com/')) {
        captured.productFetches.push(url);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
      }
      if (url === 'https://api.openai.com/v1/images/edits') {
        captured.form = init?.body as FormData;
        return openai();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

const okImage = () => Response.json({ data: [{ b64_json: 'QUJD' }] });

describe('POST /api/photoreal', () => {
  let captured: Captured;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = KEY;
    captured = { form: null, productFetches: [] };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('says so when the key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await call(look());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: false });
  });

  it('rejects an incomplete request with a message the shopper can act on', async () => {
    mockUpstream(okImage, captured);
    const res = await call(look({ photos: { front: PHOTO } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/three photos/);
    expect(captured.form).toBeNull();
  });

  it('makes the front shot from the three photos plus the product photo, and charges one look', async () => {
    mockUpstream(okImage, captured);
    const res = await call(look());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ image: 'data:image/jpeg;base64,QUJD', view: 'front', remaining: LOOK_LIMIT - 1 });
    expect(typeof data.lookToken).toBe('string');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(decodeCount(cookie.split(';')[0].split('=')[1], KEY)).toBe(1);

    expect(captured.productFetches).toEqual([PRODUCT_URL]);
    const form = captured.form!;
    expect(form.getAll('image[]')).toHaveLength(4); // front, side, face, top product photo
    expect(form.get('input_fidelity')).toBe('high');
    expect(form.get('size')).toBe('1024x1536');
    const prompt = String(form.get('prompt'));
    expect(prompt).toContain('Front view');
    expect(prompt).toContain('Image 4: product photo of the top');
    expect(prompt).toContain('rib knit, size S');
  });

  it('makes another angle with the token and the front shot, without charging another look', async () => {
    mockUpstream(okImage, captured);
    const front = await (await call(look())).json();
    const res = await call(look({ view: 'back', reference: PHOTO, lookToken: front.lookToken }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toMatchObject({ view: 'back', remaining: LOOK_LIMIT });
    expect(captured.form!.getAll('image[]')).toHaveLength(5); // + finished front shot
    expect(String(captured.form!.get('prompt'))).toContain('Image 4: the finished front photo');

    const again = await call(look({ view: 'back', reference: PHOTO, lookToken: front.lookToken }));
    expect(again.status).toBe(409);
  });

  it('compares a size with the token at no extra look, editing the finished front shot', async () => {
    mockUpstream(okImage, captured);
    const front = await (await call(look())).json();
    const reference = 'data:image/jpeg;base64,QUJDREVG'; // 6 bytes, unlike the 3 photos
    const compare = { slot: 'top', size: 'M', ease: 'relaxed', delta: { chestCm: 6, lengthCm: 3 } };
    const res = await call(look({ reference, lookToken: front.lookToken, compare }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toMatchObject({ view: 'front', compare: { slot: 'top', size: 'M' }, remaining: LOOK_LIMIT, image: expect.any(String) });
    expect(res.headers.get('set-cookie')).toBeNull();

    const images = captured.form!.getAll('image[]') as File[];
    expect(images).toHaveLength(5);
    expect(images[0].size).toBe(6); // the photo to edit leads
    const prompt = String(captured.form!.get('prompt'));
    expect(prompt).toContain('Change only the top: it is now size M instead of size S');
    expect(prompt).toContain('rib knit, size M.');

    expect((await call(look({ reference, lookToken: front.lookToken, compare }))).status).toBe(409);
  });

  it('refuses a size comparison of another outfit or without a token', async () => {
    mockUpstream(okImage, captured);
    const front = await (await call(look())).json();
    captured.form = null;
    const otherColour = look({ reference: PHOTO, lookToken: front.lookToken, compare: { slot: 'top', size: 'M' } });
    (otherColour.items as Record<string, unknown>[])[0].color = 'Red';
    expect((await call(otherColour)).status).toBe(403);
    const noToken = await call(look({ reference: PHOTO, compare: { slot: 'top', size: 'M' } }));
    expect(noToken.status).toBe(400);
    expect(captured.form).toBeNull();
  });

  it('refuses photos that are too large together', async () => {
    mockUpstream(okImage, captured);
    const big = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;
    const res = await call(look({ photos: { front: big, side: big, face: big } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
  });

  it('refuses a token from a different look', async () => {
    mockUpstream(okImage, captured);
    const front = await (await call(look())).json();
    captured.form = null;
    const other = look({ view: 'side', reference: PHOTO, lookToken: front.lookToken, scene: 'night' });
    const res = await call(other);
    expect(res.status).toBe(403);
    expect(captured.form).toBeNull();
  });

  it('refuses other angles with a forged token', async () => {
    mockUpstream(okImage, captured);
    const res = await call(look({ view: 'side', reference: PHOTO, lookToken: 'abc.9999999999999.forged' }));
    expect(res.status).toBe(403);
    expect(captured.form).toBeNull();
  });

  it('stops a visitor who has used every look', async () => {
    mockUpstream(okImage, captured);
    const res = await call(look(), `${COOKIE_NAME}=${encodeCount(LOOK_LIMIT, KEY)}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ remaining: 0, retryable: false });
    expect(captured.form).toBeNull();
  });

  it('passes the upstream failure through without charging a look', async () => {
    mockUpstream(
      () => Response.json({ error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } }, { status: 400 }),
      captured,
    );
    const res = await call(look());
    expect(res.status).toBe(422);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/safety/), retryable: true, remaining: LOOK_LIMIT });
  });

  it('still shoots when the product photo cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith('https://image.uniqlo.com/')) return new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } });
        captured.form = init?.body as FormData;
        return okImage();
      }),
    );
    const res = await call(look());
    expect(res.status).toBe(200);
    expect(captured.form!.getAll('image[]')).toHaveLength(3);
    expect(String(captured.form!.get('prompt'))).toContain('Reproduce each garment faithfully');
  });
});

describe('POST /api/photoreal with paid try-ons on', () => {
  const SECRET = 's'.repeat(40);
  const ME = { sub: 'google-7', email: 'shopper@example.com' };
  const signedIn = `${SESSION_COOKIE}=${encodeSession(ME, SECRET)}`;
  let captured: Captured;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = KEY;
    process.env.GOOGLE_CLIENT_ID = 'client.apps.googleusercontent.com';
    process.env.SESSION_SECRET = SECRET;
    resetLedger();
    captured = { form: null, productFetches: [] };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'FREE_LOOKS']) delete process.env[k];
  });

  it('asks to sign in before a new look, without calling OpenAI', async () => {
    mockUpstream(okImage, captured);
    const res = await call(look());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'signin', retryable: false });
    expect(captured.form).toBeNull();
  });

  it("charges one of the person's looks for the front (not the cookie), once per look", async () => {
    mockUpstream(okImage, captured);
    const res = await call(look(), signedIn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ account: { user: { freeUsed: 1, left: 4 } } });
    expect(res.headers.get('set-cookie')).toBeNull();
    await call(look(), signedIn); // the same look again
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 1, credits: 0 });
  });

  it('gives the look back when the shot fails', async () => {
    mockUpstream(() => Response.json({ error: { message: 'boom' } }, { status: 500 }), captured);
    const res = await call(look(), signedIn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('asks for payment when the free looks are used up', async () => {
    process.env.FREE_LOOKS = '0';
    mockUpstream(okImage, captured);
    const res = await call(look(), signedIn);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'payment', account: { user: { left: 0 } } });
    expect(captured.form).toBeNull();
  });
});
