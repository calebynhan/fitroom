import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountView, billingConfig, formatPrice, isExempt, looksLeft } from './billing';
import { GOOGLE_JWKS_URL, resetGoogleKeys, verifyGoogleIdToken } from './googleToken';
import { decodeSession, encodeSession, SESSION_COOKIE, sessionCookie } from './session';
import { checkoutForm, paidPack, signWebhook, verifyWebhook } from './stripe';

const SECRET = 'x'.repeat(40);
const CLIENT_ID = 'client-123.apps.googleusercontent.com';

describe('billing config', () => {
  const full = { GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: SECRET };

  it('is off until Google, a session secret and a ledger are all there', () => {
    expect(billingConfig({}).enabled).toBe(false);
    expect(billingConfig({ GOOGLE_CLIENT_ID: CLIENT_ID }).enabled).toBe(false);
    expect(billingConfig(full).enabled).toBe(true); // off Vercel the in-memory ledger stands in
    expect(billingConfig({ ...full, VERCEL: '1' }).enabled).toBe(false); // a deployment needs Upstash
    expect(billingConfig({ ...full, VERCEL: '1', KV_REST_API_URL: 'https://u', KV_REST_API_TOKEN: 't' }).enabled).toBe(true);
    expect(billingConfig({ ...full, BILLING_DISABLED: '1' }).enabled).toBe(false);
  });

  it('refuses a short session secret', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(billingConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: 'short' }).enabled).toBe(false);
    vi.restoreAllMocks();
  });

  it('defaults to 5 free looks and a pack of 20 for $4.99, all overridable', () => {
    const c = billingConfig(full);
    expect([c.freeLooks, c.pack.looks, c.pack.amount, c.pack.currency]).toEqual([5, 20, 499, 'usd']);
    const d = billingConfig({ ...full, FREE_LOOKS: '0', PACK_LOOKS: '10', PACK_PRICE_CENTS: '300', PACK_CURRENCY: 'EUR', STRIPE_PRICE_ID: 'price_1' });
    expect([d.freeLooks, d.pack.looks, d.pack.amount, d.pack.currency, d.pack.priceId]).toEqual([0, 10, 300, 'eur', 'price_1']);
    expect(billingConfig({ ...full, FREE_LOOKS: 'many', PACK_LOOKS: '-2' }).freeLooks).toBe(5);
    expect(formatPrice({ amount: 499, currency: 'usd' })).toBe('$4.99');
  });

  it('exempts listed emails, whatever their case', () => {
    expect(isExempt('Someone@Example.com', { BILLING_EXEMPT_EMAILS: 'friend@x.io, someone@example.com' })).toBe(true);
    expect(isExempt('stranger@example.com', { BILLING_EXEMPT_EMAILS: 'friend@x.io' })).toBe(false);
    expect(isExempt('stranger@example.com', {})).toBe(false);
  });

  it('counts free and paid looks left; unlimited for exempt accounts', () => {
    const c = billingConfig(full);
    expect(looksLeft(c, { freeUsed: 2, credits: 0 }, false)).toBe(3);
    expect(looksLeft(c, { freeUsed: 5, credits: 7 }, false)).toBe(7);
    expect(looksLeft(c, { freeUsed: 5, credits: 0 }, true)).toBeNull();
    const view = accountView(c, { email: 'a@b.c', balance: { freeUsed: 9, credits: -1 } });
    expect(view.user).toEqual({ email: 'a@b.c', exempt: false, freeUsed: 5, credits: 0, left: 0 });
    expect(view.pack).toBeNull(); // no Stripe key: nothing on sale
    expect(accountView({ ...c, stripeKey: 'sk' }, null).pack).toEqual({ looks: 20, price: '$4.99' });
    expect(accountView(billingConfig({}), null)).toMatchObject({ billing: false, user: null, googleClientId: null });
  });
});

describe('session cookie', () => {
  const user = { sub: '1234', email: 'a@b.c' };

  it('round-trips and expires', () => {
    const value = encodeSession(user, SECRET, 1_000_000);
    expect(decodeSession(value, SECRET, 1_000_000)).toEqual(user);
    expect(decodeSession(value, SECRET, 1_000_000 + 31 * 24 * 3600 * 1000)).toBeNull();
  });

  it('refuses forgeries and junk', () => {
    const value = encodeSession(user, SECRET);
    const [payload] = value.split('.');
    const forged = `${Buffer.from(JSON.stringify({ s: 'other', e: 'x@y.z', x: 9e9 })).toString('base64url')}.${value.split('.')[1]}`;
    expect(decodeSession(forged, SECRET)).toBeNull();
    expect(decodeSession(value, 'y'.repeat(40))).toBeNull();
    expect(decodeSession(`${payload}.`, SECRET)).toBeNull();
    expect(decodeSession('nonsense', SECRET)).toBeNull();
    expect(decodeSession(undefined, SECRET)).toBeNull();
  });

  it('is HttpOnly, Secure, SameSite=Lax and scoped to /api', () => {
    const cookie = sessionCookie(user, SECRET);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toMatch(/Path=\/api; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
  });
});

describe('Google ID token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
  const now = Date.UTC(2026, 10, 11) / 1000;
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1098', email: 'a@b.c', email_verified: true, iat: now, exp: now + 3600 };
  let keyFetches = 0;

  function token(overrides: Record<string, unknown> = {}, kid = 'key-1', key = privateKey): string {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part({ ...claims, ...overrides })}`;
    return `${head}.${rsaSign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
  }

  beforeEach(() => {
    resetGoogleKeys();
    keyFetches = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url !== GOOGLE_JWKS_URL) throw new Error(`unexpected ${url}`);
      keyFetches += 1;
      return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a genuine token and caches the keys', async () => {
    expect(await verifyGoogleIdToken(token(), CLIENT_ID, now * 1000)).toEqual({ ok: true, identity: { sub: '1098', email: 'a@b.c' } });
    await verifyGoogleIdToken(token(), CLIENT_ID, now * 1000);
    expect(keyFetches).toBe(1);
  });

  it('refuses the wrong audience, issuer, an expired token or an unverified email', async () => {
    const at = now * 1000;
    expect(await verifyGoogleIdToken(token({ aud: 'someone-else' }), CLIENT_ID, at)).toMatchObject({ ok: false, reason: 'wrong audience' });
    expect(await verifyGoogleIdToken(token({ iss: 'evil.com' }), CLIENT_ID, at)).toMatchObject({ ok: false, reason: 'wrong issuer' });
    expect(await verifyGoogleIdToken(token({ exp: now - 3600 }), CLIENT_ID, at)).toMatchObject({ ok: false, reason: 'expired' });
    expect(await verifyGoogleIdToken(token({ email_verified: false }), CLIENT_ID, at)).toMatchObject({ ok: false, reason: 'email not verified' });
  });

  it('refuses a token signed by anyone else or naming an unknown key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await verifyGoogleIdToken(token({}, 'key-1', other), CLIENT_ID, now * 1000)).toMatchObject({ ok: false, reason: 'bad signature' });
    expect(await verifyGoogleIdToken(token({}, 'key-9'), CLIENT_ID, now * 1000)).toMatchObject({ ok: false, reason: 'unknown key' });
    expect(keyFetches).toBe(2); // an unknown key refetches once (rotation)
    expect(await verifyGoogleIdToken('a.b', CLIENT_ID)).toMatchObject({ ok: false });
    expect(await verifyGoogleIdToken(42, CLIENT_ID)).toMatchObject({ ok: false });
  });
});

describe('Stripe', () => {
  const pack = { looks: 20, amount: 499, currency: 'usd', priceId: null };
  const user = { sub: 'g-1', email: 'a@b.c' };

  it('builds a checkout for one pack, tied to the account, priced on the server', () => {
    const form = checkoutForm(pack, user, 'https://fitroom.test');
    expect(form.get('mode')).toBe('payment');
    expect(form.get('client_reference_id')).toBe('g-1');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('499');
    expect(form.get('metadata[looks]')).toBe('20');
    expect(form.get('success_url')).toBe('https://fitroom.test/?checkout=done&session_id={CHECKOUT_SESSION_ID}');
    const priced = checkoutForm({ ...pack, priceId: 'price_9' }, user, 'https://fitroom.test');
    expect(priced.get('line_items[0][price]')).toBe('price_9');
    expect(priced.get('line_items[0][price_data][unit_amount]')).toBeNull();
  });

  it('reads who paid for how many looks, only once paid', () => {
    const session = { id: 'cs_test_1', url: null, payment_status: 'paid', client_reference_id: 'g-1', metadata: { looks: '20', email: 'a@b.c' } };
    expect(paidPack(session)).toEqual({ sub: 'g-1', email: 'a@b.c', looks: 20 });
    expect(paidPack({ ...session, payment_status: 'unpaid' })).toBeNull();
    expect(paidPack({ ...session, metadata: { looks: 'lots' } })).toBeNull();
  });

  it('accepts only genuine, recent webhooks', () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const t = 1_800_000_000;
    const header = `t=${t},v1=${signWebhook(body, 'whsec_1', t)}`;
    expect(verifyWebhook(body, header, 'whsec_1', t + 10)).toEqual({ type: 'checkout.session.completed' });
    expect(verifyWebhook(body, header, 'whsec_2', t + 10)).toBeNull();
    expect(verifyWebhook(`${body} `, header, 'whsec_1', t + 10)).toBeNull();
    expect(verifyWebhook(body, header, 'whsec_1', t + 1000)).toBeNull();
    expect(verifyWebhook(body, null, 'whsec_1', t)).toBeNull();
  });
});
