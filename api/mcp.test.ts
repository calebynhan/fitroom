import { createHash, generateKeyPairSync, randomBytes, sign as rsaSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as mcpPost } from './mcp';
import { GET as oauthGet, POST as oauthPost } from './oauth';
import { ledger, resetLedger } from './_lib/ledger';
import { GOOGLE_JWKS_URL, resetGoogleKeys } from './_lib/googleToken';
import { resetCatalog, WIDGET_URI } from './_lib/mcpServer';
import { resetClients } from './_lib/oauth';
import { encodeSession, SESSION_COOKIE } from './_lib/session';

const ORIGIN = 'https://fitroom.test';
const SECRET = 'o'.repeat(40);
const GOOGLE_ID = 'google-client.apps.googleusercontent.com';
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const ME = { sub: 'google-77', email: 'shopper@example.com' };
const PHOTO = { download_url: 'https://files.example.com/me.jpg', file_id: 'file_1', mime_type: 'image/jpeg' };

const ITEM = (id: string, slot: 'top' | 'bottom', name: string) => ({
  id,
  name,
  price: 29.9,
  salePrice: null,
  slot,
  shape: slot === 'top' ? 'sweater' : 'pants',
  fabric: 'rib_knit',
  fit: 'regular',
  url: `https://www.uniqlo.com/us/en/products/${id}/00`,
  image: `https://image.uniqlo.com/UQ/ST3/us/imagesgoods/${id.slice(1, 7)}/item/usgoods_09_${id.slice(1, 7)}_3x4.jpg`,
  colors: [
    { code: '09', name: 'Black', hex: '#111111', swatch: '' },
    { code: '67', name: 'Blue', hex: '#223355', swatch: '' },
  ],
  sizes: ['S', 'M', 'L'],
  sizeChart: { S: { chestCm: 92, body: { chestCm: [86, 92] } } },
});
const CATALOG = { items: [ITEM('E453754-000', 'top', 'Washable Milano Ribbed Sweater'), ITEM('E475598-000', 'bottom', 'Ultra Stretch Pants')] };

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
  resetCatalog();
  resetClients();
  resetGoogleKeys();
  fetches = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetches.push(url);
    if (url === `${ORIGIN}/catalog.json`) return Response.json(CATALOG);
    if (url === CLIENT_ID) return Response.json({ client_id: CLIENT_ID, client_name: 'ChatGPT', redirect_uris: [REDIRECT], token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] });
    if (url === GOOGLE_JWKS_URL) return Response.json({ keys: [jwk] });
    if (url === PHOTO.download_url) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } });
    throw new Error(`unexpected fetch ${url} ${init?.method ?? ''}`);
  });
});
afterEach(() => {
  for (const k of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'APP_URL']) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- MCP over HTTP, as ChatGPT sends it ----

let rpcId = 0;
async function rpc(method: string, params: object = {}, token?: string): Promise<{ status: number; body: any; headers: Headers }> {
  rpcId += 1;
  const res = await mcpPost(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'x-forwarded-for': `10.9.0.${rpcId % 250}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const call = (name: string, args: object, token?: string) => rpc('tools/call', { name, arguments: args }, token);

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
    resource: `${ORIGIN}/mcp`,
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
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier, resource: `${ORIGIN}/mcp` }),
    }),
  );
  expect(tokenRes.status).toBe(200);
  const tokens = await tokenRes.json();
  expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'tryon' });
  return { access: tokens.access_token, refresh: tokens.refresh_token };
}

describe('OAuth for ChatGPT', () => {
  it('publishes resource and authorization server metadata (CIMD, PKCE S256, iss)', async () => {
    const prm = await (await oauthGet(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`))).json();
    expect(prm).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
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

describe('MCP server', () => {
  it('initializes and lists the tools with auth, file params, UI and annotations', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('fitroom');
    expect(init.body.result.instructions).toContain('find_clothes');
    const { body } = await rpc('tools/list');
    const tools = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t]));
    expect(Object.keys(tools).sort()).toEqual(['charge_look', 'fetch_photo', 'find_clothes', 'get_profile', 'my_try_ons', 'refund_look', 'try_on']);
    const tryOn = tools.try_on;
    expect(tryOn._meta['openai/fileParams']).toEqual(['photo']);
    expect(tryOn._meta.ui.resourceUri).toBe(WIDGET_URI);
    expect(tryOn._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['tryon'] }]);
    const photo = tryOn.inputSchema.properties.photo;
    expect(photo.required.sort()).toEqual(['download_url', 'file_id']);
    expect(Object.keys(photo.properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type']);
    for (const t of Object.values(tools) as any[]) {
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
      expect(typeof t.annotations.openWorldHint).toBe('boolean');
    }
    expect(tools.charge_look._meta.ui.visibility).toEqual(['app']);
    expect(tools.get_profile._meta['openai/profile']).toBe(true);
  });

  it('serves the panel with a CSP naming the site, the try-on Space and Hugging Face', async () => {
    const { body } = await rpc('resources/read', { uri: WIDGET_URI });
    const res = body.result.contents[0];
    expect(res.mimeType).toBe('text/html;profile=mcp-app');
    expect(res.text).toContain(`${ORIGIN}/widget/fitroom-tryon.js`);
    expect(res._meta.ui.domain).toBe(ORIGIN);
    expect(res._meta.ui.csp.connectDomains).toEqual([ORIGIN, 'https://fashn-ai-fashn-vton-1-5.hf.space', 'https://huggingface.co']);
  });

  it('finds clothes without an account', async () => {
    const { body } = await call('find_clothes', { query: 'sweater', slot: 'top' });
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.items).toHaveLength(1);
    expect(body.result.structuredContent.items[0]).toMatchObject({ id: 'E453754-000', colors: [{ code: '09', name: 'Black' }, { code: '67', name: 'Blue' }] });
  });

  it('asks ChatGPT to link FitRoom before a try-on (challenge in _meta)', async () => {
    const { body } = await call('try_on', { photo: PHOTO, top: { id: 'E453754-000' } });
    expect(body.result.isError).toBe(true);
    expect(body.result._meta['mcp/www_authenticate'][0]).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it('answers 401 with WWW-Authenticate for a bad token', async () => {
    const res = await rpc('tools/list', {}, 'fr1.bad.token');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('with a linked account: try_on renders the panel data; charge_look spends the same looks as the website', async () => {
    const { access } = await linkAccount();
    const tryOn = await call('try_on', { photo: PHOTO, top: { id: 'E453754-000', color: 'blue' }, bottom: { id: 'E475598-000' }, height_cm: 178, weight_kg: 65 }, access);
    const result = tryOn.body.result;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.outfit.map((o: any) => [o.slot, o.color_code])).toEqual([['top', '67'], ['bottom', '09']]);
    expect(result.structuredContent.try_ons_left).toBe(5);
    expect(result._meta.fitroom.items[0].garment).toBe(`${ORIGIN}/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg`);
    expect(result._meta.fitroom.photo.download_url).toBe(PHOTO.download_url);
    expect(JSON.stringify(result.structuredContent)).not.toContain('download_url'); // the photo address stays out of the model's view

    const look = 'L'.repeat(43);
    const charged = await call('charge_look', { look }, access);
    expect(charged.body.result.structuredContent).toMatchObject({ ok: true, charged: true, account: { user: { left: 4 } } });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 1, credits: 0 });
    const again = await call('charge_look', { look }, access);
    expect(again.body.result.structuredContent.charged).toBe(false);
    await call('refund_look', { look }, access);
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('says why when the account has no try-ons left, with an informational link and no checkout', async () => {
    process.env.FREE_LOOKS = '0';
    try {
      const { access } = await linkAccount();
      const res = await call('charge_look', { look: 'M'.repeat(43) }, access);
      expect(res.body.result.isError).toBe(true);
      const msg = res.body.result.content[0].text;
      expect(msg).toContain(`${ORIGIN}/try-ons.html`);
      expect(msg).not.toMatch(/buy|checkout|stripe|\$/i);
    } finally {
      delete process.env.FREE_LOOKS;
    }
  });

  it('loads the photo for the panel into _meta only', async () => {
    const { access } = await linkAccount();
    const res = await call('fetch_photo', { photo: PHOTO }, access);
    expect(res.body.result._meta.photo).toMatch(/^data:image\/jpeg;base64,/);
    expect(JSON.stringify(res.body.result.structuredContent)).not.toContain('base64');
    const local = await call('fetch_photo', { photo: { ...PHOTO, download_url: 'http://169.254.169.254/latest' } }, access);
    expect(local.body.result.isError).toBe(true);
  });

  it('works without accounts when paid try-ons are off (no sign-in anywhere)', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { body } = await rpc('tools/list');
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).not.toContain('my_try_ons');
    const tryOn = body.result.tools.find((t: any) => t.name === 'try_on');
    expect(tryOn._meta.securitySchemes).toEqual([{ type: 'noauth' }]);
    const res = await call('try_on', { photo: PHOTO, bottom: { id: 'E475598-000' } });
    expect(res.body.result.isError).toBeFalsy();
    const charge = await call('charge_look', { look: 'N'.repeat(43) });
    expect(charge.body.result.structuredContent).toMatchObject({ ok: true, charged: false });
  });
});
