import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAccount, POST as postAccount } from './account';
import { POST as postCheckout } from './checkout';
import { POST as postCredits } from './credits';
import { POST as postStripe } from './stripe';
import { ledger, resetLedger } from './_lib/ledger';
import { encodeSession, SESSION_COOKIE } from './_lib/session';
import { GOOGLE_JWKS_URL, resetGoogleKeys } from './_lib/googleToken';
import { signWebhook } from './_lib/stripe';

const SECRET = 's'.repeat(40);
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const ME = { sub: 'google-42', email: 'shopper@example.com' };
const LOOK = 'A'.repeat(43);

let ip = 0;
function request(path: string, init: { method?: string; body?: unknown; user?: typeof ME | null; headers?: Record<string, string> } = {}): Request {
  ip += 1;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip}`, ...init.headers };
  if (init.user !== null) headers.cookie = `${SESSION_COOKIE}=${encodeSession(init.user ?? ME, SECRET)}`;
  return new Request(`https://fitroom.test${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
}

const charge = (look = LOOK, user?: typeof ME | null) => postCredits(request('/api/credits', { body: { action: 'charge', look }, user }));

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.SESSION_SECRET = SECRET;
  resetLedger();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_EXEMPT_EMAILS', 'FREE_LOOKS']) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/account', () => {
  it('says billing is off when it is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await (await getAccount(request('/api/account', { method: 'GET' }))).json()).toMatchObject({ billing: false, user: null });
  });

  it('shows the signed-in person and their free looks', async () => {
    await charge();
    const view = await (await getAccount(request('/api/account', { method: 'GET' }))).json();
    expect(view).toMatchObject({ billing: true, googleClientId: CLIENT_ID, freeLooks: 5, pack: null });
    expect(view.user).toEqual({ email: ME.email, exempt: false, freeUsed: 1, credits: 0, left: 4 });
  });

  it('shows nobody for a forged or missing cookie', async () => {
    const forged = await getAccount(request('/api/account', { method: 'GET', user: null, headers: { cookie: `${SESSION_COOKIE}=abc.def` } }));
    expect((await forged.json()).user).toBeNull();
  });
});

describe('POST /api/account', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  function googleToken(claims: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = { iss: 'accounts.google.com', aud: CLIENT_ID, sub: ME.sub, email: ME.email, email_verified: true, iat: now, exp: now + 600, ...claims };
    const head = `${part({ alg: 'RS256', kid: 'k1' })}.${part(body)}`;
    return `${head}.${rsaSign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
  }
  beforeEach(() => {
    resetGoogleKeys();
    vi.stubGlobal('fetch', async (url: string) => (url === GOOGLE_JWKS_URL ? Response.json({ keys: [jwk] }) : Promise.reject(new Error(url))));
  });

  it('signs in with a Google credential and sets an HttpOnly session cookie', async () => {
    const res = await postAccount(request('/api/account', { user: null, body: { action: 'signin', credential: googleToken() } }));
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ email: ME.email, left: 5 });
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${SESSION_COOKIE}=.+HttpOnly`));
  });

  it("refuses a credential Google didn't issue for this site", async () => {
    const res = await postAccount(request('/api/account', { user: null, body: { action: 'signin', credential: googleToken({ aud: 'other-app' }) } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('signs out by clearing the cookie', async () => {
    const res = await postAccount(request('/api/account', { body: { action: 'signout' } }));
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
});

describe('POST /api/credits', () => {
  it('asks to sign in first', async () => {
    const res = await charge(LOOK, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'signin' });
  });

  it('charges five free looks, the same look only once, then asks for payment', async () => {
    for (let i = 0; i < 5; i += 1) expect((await (await charge(`${'L'.repeat(40)}-${i}`)).json()).charged).toBe(true);
    expect(await (await charge(`${'L'.repeat(40)}-0`)).json()).toMatchObject({ ok: true, charged: false, account: { user: { left: 0 } } });
    const res = await charge(`${'L'.repeat(40)}-5`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'payment', error: "You've used your 5 free try-ons.", account: { user: { left: 0 } } });
  });

  it('never charges an exempt account', async () => {
    process.env.BILLING_EXEMPT_EMAILS = ME.email;
    process.env.FREE_LOOKS = '0';
    const body = await (await charge()).json();
    expect(body).toMatchObject({ ok: true, charged: false, account: { user: { exempt: true, left: null } } });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('gives back a look that made no photo', async () => {
    await charge();
    const res = await postCredits(request('/api/credits', { body: { action: 'refund', look: LOOK } }));
    expect(await res.json()).toMatchObject({ ok: true, account: { user: { freeUsed: 0, left: 5 } } });
  });

  it("can't name a look the server charged (the paid generator's)", async () => {
    const res = await postCredits(request('/api/credits', { body: { action: 'refund', look: `p:${LOOK}` } }));
    expect(res.status).toBe(400);
  });

  it('lets everything through when billing is off', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await (await charge(LOOK, null)).json()).toMatchObject({ ok: true, charged: false, account: { billing: false } });
  });
});

describe('checkout', () => {
  const SESSION_ID = 'cs_test_a1b2c3d4e5f6';
  let stripeCalls: { url: string; body: string }[];
  let paid = true;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    stripeCalls = [];
    paid = true;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      stripeCalls.push({ url, body: String(init?.body ?? '') });
      if (url === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({ id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/x' });
      if (url === `https://api.stripe.com/v1/checkout/sessions/${SESSION_ID}`) {
        return Response.json({ id: SESSION_ID, payment_status: paid ? 'paid' : 'unpaid', client_reference_id: ME.sub, metadata: { looks: '20', email: ME.email } });
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  it('opens a Stripe payment page for the signed-in person', async () => {
    const res = await postCheckout(request('/api/checkout', { body: { action: 'start' } }));
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/x' });
    const form = new URLSearchParams(stripeCalls[0].body);
    expect(form.get('client_reference_id')).toBe(ME.sub);
    expect(form.get('success_url')).toBe('https://fitroom.test/?checkout=done&session_id={CHECKOUT_SESSION_ID}');
  });

  it('needs a signed-in person and a Stripe key', async () => {
    expect((await postCheckout(request('/api/checkout', { user: null, body: { action: 'start' } }))).status).toBe(401);
    delete process.env.STRIPE_SECRET_KEY;
    expect((await postCheckout(request('/api/checkout', { body: { action: 'start' } }))).status).toBe(503);
  });

  it('adds the pack once when the shopper comes back, and the webhook does not add it again', async () => {
    const confirm = () => postCheckout(request('/api/checkout', { body: { action: 'confirm', sessionId: SESSION_ID } }));
    expect(await (await confirm()).json()).toMatchObject({ added: 20, account: { user: { credits: 20, left: 25 } } });
    expect(await (await confirm()).json()).toMatchObject({ added: 0, account: { user: { credits: 20 } } });
    const event = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: SESSION_ID, payment_status: 'paid', client_reference_id: ME.sub, metadata: { looks: '20', email: ME.email } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const hook = await postStripe(request('/api/stripe', { user: null, body: event, headers: { 'stripe-signature': `t=${t},v1=${signWebhook(event, 'whsec_test', t)}` } }));
    expect(hook.status).toBe(200);
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 20 });
  });

  it("refuses to confirm a session that isn't paid or isn't yours", async () => {
    paid = false;
    expect((await postCheckout(request('/api/checkout', { body: { action: 'confirm', sessionId: SESSION_ID } }))).status).toBe(409);
    paid = true;
    const other = { sub: 'google-99', email: 'x@y.z' };
    expect((await postCheckout(request('/api/checkout', { user: other, body: { action: 'confirm', sessionId: SESSION_ID } }))).status).toBe(403);
    expect((await postCheckout(request('/api/checkout', { body: { action: 'confirm', sessionId: '../../evil' } }))).status).toBe(400);
  });

  it('credits a paid session from the webhook alone, and refuses a bad signature', async () => {
    const event = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_zzzzzzzzzz', payment_status: 'paid', client_reference_id: ME.sub, metadata: { looks: '20', email: ME.email } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const bad = await postStripe(request('/api/stripe', { user: null, body: event, headers: { 'stripe-signature': `t=${t},v1=deadbeef` } }));
    expect(bad.status).toBe(400);
    const good = await postStripe(request('/api/stripe', { user: null, body: event, headers: { 'stripe-signature': `t=${t},v1=${signWebhook(event, 'whsec_test', t)}` } }));
    expect(good.status).toBe(200);
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 20 });
  });
});
