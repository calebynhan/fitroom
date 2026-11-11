// FitRoom's OAuth for the ChatGPT plugin, end to end as ChatGPT runs it: discovery, the approve page, code + PKCE,
// tokens, refresh, and the refusals (unknown clients, redirects, cross-site approvals).
import { createHash, generateKeyPairSync, randomBytes, sign as rsaSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as mcpPost } from './mcp';
import { GET as oauthGet, POST as oauthPost } from './oauth';
import { resetLedger } from './_lib/ledger';
import { GOOGLE_JWKS_URL, resetGoogleKeys } from './_lib/googleToken';
import { resetClients } from './_lib/oauth';
import { encodeSession, SESSION_COOKIE } from './_lib/session';

const ORIGIN = 'https://fitroom.test';
const SECRET = 'o'.repeat(40);
const GOOGLE_ID = 'google-client.apps.googleusercontent.com';
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const ME = { sub: 'google-77', email: 'shopper@example.com' };

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256' };
function googleCredential(): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${part({ alg: 'RS256', kid: 'g1' })}.${part({ iss: 'https://accounts.google.com', aud: GOOGLE_ID, sub: ME.sub, email: ME.email, email_verified: true, iat: now, exp: now + 600 })}`;
  return `${head}.${rsaSign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
}

let fetches: string[];
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = GOOGLE_ID;
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_URL = ORIGIN;
  resetLedger();
  resetClients();
  resetGoogleKeys();
  fetches = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetches.push(url);
    if (url === CLIENT_ID) return Response.json({ client_id: CLIENT_ID, client_name: 'ChatGPT', redirect_uris: [REDIRECT], token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] });
    if (url === GOOGLE_JWKS_URL) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url} ${init?.method ?? ''}`);
  });
});
afterEach(() => {
  for (const k of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'APP_URL']) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- OAuth, as ChatGPT runs it ----

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: 'st-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'tryon',
    resource: `${ORIGIN}/api/mcp`,
    ...extra,
  });
}

async function linkAccount(): Promise<{ access: string; refresh: string }> {
  const { verifier, challenge } = pkce();
  const form = authorizeParams(challenge);
  form.set('action', 'google');
  form.set('credential', googleCredential());
  const approved = await oauthPost(
    new Request(`${ORIGIN}/api/oauth?step=authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
      body: form,
    }),
  );
  expect(approved.status).toBe(303);
  const back = new URL(approved.headers.get('location')!);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('st-1');
  expect(back.searchParams.get('iss')).toBe(ORIGIN);
  const tokenRes = await oauthPost(
    new Request(`${ORIGIN}/api/oauth?step=token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier, resource: `${ORIGIN}/api/mcp` }),
    }),
  );
  expect(tokenRes.status).toBe(200);
  const tokens = await tokenRes.json();
  expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'tryon' });
  return { access: tokens.access_token, refresh: tokens.refresh_token };
}

describe('OAuth for ChatGPT', () => {
  it('publishes resource and authorization server metadata (CIMD, PKCE S256, iss)', async () => {
    const prm = await (await oauthGet(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`))).json();
    expect(prm).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    const as = await (await oauthGet(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('is off (404) when paid try-ons are not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await oauthGet(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).status).toBe(404);
  });

  it('shows the connect page with Google sign-in, and "Continue as" for a signed-in shopper', async () => {
    const { challenge } = pkce();
    const page = await oauthGet(new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams(challenge)}`));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain('Use FitRoom in ChatGPT');
    expect(html).toContain(`data-client_id="${GOOGLE_ID}"`);
    const signedIn = await oauthGet(
      new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams(challenge)}`, { headers: { cookie: `${SESSION_COOKIE}=${encodeSession(ME, SECRET)}` } }),
    );
    expect(await signedIn.text()).toContain(`Continue as ${ME.email}`);
  });

  it('refuses clients outside chatgpt.com/openai.com and redirect URIs the client did not register, without redirecting', async () => {
    const { challenge } = pkce();
    const evil = await oauthGet(new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams(challenge, { client_id: 'https://evil.example/client.json' })}`));
    expect(evil.status).toBe(400);
    const wrongRedirect = await oauthGet(new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams(challenge, { redirect_uri: 'https://evil.example/cb' })}`));
    expect(wrongRedirect.status).toBe(400);
    expect(wrongRedirect.headers.get('location')).toBeNull();
  });

  it('sends a request without PKCE back to the client with an error and iss', async () => {
    const res = await oauthGet(new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams('x', { code_challenge_method: 'plain' })}`));
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('location')!);
    expect(back.searchParams.get('error')).toBe('invalid_request');
    expect(back.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('links the account: Google sign-in -> code -> tokens; a code works once; refresh works', async () => {
    const { verifier, challenge } = pkce();
    const form = authorizeParams(challenge);
    form.set('action', 'google');
    form.set('credential', googleCredential());
    const approved = await oauthPost(
      new Request(`${ORIGIN}/api/oauth?step=authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: form }),
    );
    expect(approved.headers.get('set-cookie')).toContain(SESSION_COOKIE); // signed in on the website too
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
    const exchange = (body: Record<string, string>) =>
      oauthPost(new Request(`${ORIGIN}/api/oauth?step=token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }));
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID };
    expect((await exchange({ ...base, code_verifier: randomBytes(32).toString('base64url') })).status).toBe(400); // wrong verifier
    const ok = await exchange({ ...base, code_verifier: verifier });
    expect(ok.status).toBe(200);
    const again = await exchange({ ...base, code_verifier: verifier });
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
    const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: (await ok.json()).refresh_token, client_id: CLIENT_ID });
    expect(await refreshed.json()).toMatchObject({ token_type: 'Bearer' });
  });

  it('refuses a cross-site approval and an approval with a forged CSRF token', async () => {
    const { challenge } = pkce();
    const form = authorizeParams(challenge);
    form.set('action', 'continue');
    form.set('csrf', 'fr1.forged.sig');
    const crossSite = await oauthPost(
      new Request(`${ORIGIN}/api/oauth?step=authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }, body: form }),
    );
    expect(crossSite.status).toBe(403);
    const forged = await oauthPost(
      new Request(`${ORIGIN}/api/oauth?step=authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, cookie: `${SESSION_COOKIE}=${encodeSession(ME, SECRET)}` },
        body: form,
      }),
    );
    expect(forged.status).toBe(401);
    expect(forged.headers.get('location')).toBeNull();
  });

  it('declining sends access_denied back to ChatGPT', async () => {
    const { challenge } = pkce();
    const form = authorizeParams(challenge);
    form.set('action', 'deny');
    const res = await oauthPost(new Request(`${ORIGIN}/api/oauth?step=authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: form }));
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });
});

describe('the linked account on /api/mcp', () => {
  async function mcp(method: string, params: object, token?: string): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await mcpPost(
      new Request(`${ORIGIN}/api/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }

  it('accepts the access token from the flow: try_on needs the account, and the account tools answer', async () => {
    const { access } = await linkAccount();
    const list = await mcp('tools/list', {}, access);
    const tools = Object.fromEntries(list.body.result.tools.map((t: any) => [t.name, t]));
    expect(tools.try_on._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['tryon'] }]);
    expect(tools.recommend_size._meta.securitySchemes).toEqual([{ type: 'noauth' }]);
    expect(tools.get_profile._meta['openai/profile']).toBe(true);
    const left = await mcp('tools/call', { name: 'my_try_ons', arguments: {} }, access);
    expect(left.body.result.structuredContent).toMatchObject({ try_ons_left: 5, free_try_ons: 5 });
    const profile = await mcp('tools/call', { name: 'get_profile', arguments: {} }, access);
    expect(profile.body.result.structuredContent).toMatchObject({ id: expect.stringMatching(/^fr_/), email: ME.email });
  });

  it('answers 401 with a challenge for a bad token, and asks an anonymous caller to link before an account tool', async () => {
    const bad = await mcp('tools/list', {}, 'fr1.bad.token');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
    const anon = await mcp('tools/call', { name: 'my_try_ons', arguments: {} });
    expect(anon.body.result.isError).toBe(true);
    expect(anon.body.result._meta['mcp/www_authenticate'][0]).toContain('error="invalid_token"');
  });
});
