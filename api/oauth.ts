// OAuth 2.1 for the ChatGPT plugin (api/_lib/oauth.ts). One function, routed by `step` (vercel.json rewrites):
//   GET  /.well-known/oauth-protected-resource[/mcp]  step=resource   RFC 9728 metadata for /mcp
//   GET  /.well-known/oauth-authorization-server      step=server     RFC 8414 metadata
//   GET  /api/oauth/authorize                         step=authorize  the "connect FitRoom" page (Google sign-in)
//   POST /api/oauth/authorize                                         approve (Google credential, or the signed-in
//                                                                     account + CSRF token) or decline -> redirect
//   POST /api/oauth/token                             step=token      code (+ PKCE) or refresh token -> tokens
// Off (404) unless paid try-ons are configured: without accounts the plugin needs no sign-in.
// The page lives under /api so the website's session cookie (Path=/api) can offer "Continue as ...".
import { billingConfig, type BillingConfig } from './_lib/billing';
import { siteOrigin } from './_lib/account';
import { verifyGoogleIdToken } from './_lib/googleToken';
import { json } from './_lib/http';
import { ledger } from './_lib/ledger';
import {
  authorizationServerMetadata,
  authorizeRedirect,
  CODE_TTL_S,
  CSRF_TTL_S,
  expiresIn,
  issueCode,
  issueTokens,
  parseAuthorize,
  pkceOk,
  protectedResourceMetadata,
  readToken,
  requestDigest,
  signToken,
  AUTHORIZE_FIELDS,
  type AuthorizeRequest,
  type OAuthClient,
} from './_lib/oauth';
import { clientIp } from './_lib/rateLimit';
import { readSession, sessionCookie, type SessionUser } from './_lib/session';
import { createWindowLimiter } from './_lib/windowLimit';

const limiter = createWindowLimiter({ limit: 60, windowMs: 60_000 });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, authorization' };
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // a consent page must never be framed (clickjacking)
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function stepOf(request: Request): string {
  const url = new URL(request.url);
  const step = url.searchParams.get('step');
  if (step) return step;
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return 'resource';
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) return 'server';
  return url.pathname.split('/').pop() ?? '';
}

function ready(config: BillingConfig): config is BillingConfig & { sessionSecret: string; googleClientId: string } {
  return config.enabled && Boolean(config.sessionSecret && config.googleClientId);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<Response> {
  const config = billingConfig();
  const origin = siteOrigin(request);
  const step = stepOf(request);
  if (!ready(config)) return json({ error: 'not_found' }, 404, CORS);
  if (step === 'resource') return json(protectedResourceMetadata(origin), 200, { ...CORS, 'Cache-Control': 'public, max-age=300' });
  if (step === 'server') return json(authorizationServerMetadata(origin), 200, { ...CORS, 'Cache-Control': 'public, max-age=300' });
  if (step !== 'authorize') return json({ error: 'not_found' }, 404, CORS);

  const params = new URL(request.url).searchParams;
  const parsed = await parseAuthorize(params, origin);
  if (!parsed.ok) {
    if (!parsed.redirect) return page(errorPage(parsed.message), 400);
    return Response.redirect(authorizeRedirect(parsed.redirectUri, origin, parsed.state, { error: parsed.error, description: parsed.description }), 302);
  }
  const user = readSession(request, config.sessionSecret);
  return page(consentPage({ origin, client: parsed.client, request: parsed.request, params, user, config }));
}

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();
  const origin = siteOrigin(request);
  const step = stepOf(request);
  if (!ready(config)) return json({ error: 'not_found' }, 404, CORS);
  const verdict = limiter.hit(clientIp(request));
  if (!verdict.ok) return json({ error: 'slow_down' }, 429, { ...CORS, 'Retry-After': String(verdict.retryAfterS) });
  if (step === 'token') return token(request, origin, config);
  if (step === 'authorize') return approve(request, origin, config);
  return json({ error: 'not_found' }, 404, CORS);
}

// ---- Approve or decline ----

/** The consent form posts from our own page only (a cross-site form could approve on the shopper's behalf). */
function fromOurPage(request: Request, origin: string): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const from = request.headers.get('origin');
  return from === null || from === origin;
}

async function approve(request: Request, origin: string, config: BillingConfig & { sessionSecret: string; googleClientId: string }): Promise<Response> {
  if (!fromOurPage(request, origin)) return page(errorPage('This approval did not come from the FitRoom page. Start again from ChatGPT.'), 403);
  const form = new URLSearchParams(await request.text());
  const params = new URLSearchParams();
  for (const k of AUTHORIZE_FIELDS) {
    const v = form.get(k);
    if (v !== null) params.set(k, v);
  }
  const parsed = await parseAuthorize(params, origin);
  if (!parsed.ok) {
    if (!parsed.redirect) return page(errorPage(parsed.message), 400);
    return Response.redirect(authorizeRedirect(parsed.redirectUri, origin, parsed.state, { error: parsed.error, description: parsed.description }), 303);
  }
  const { request: req } = parsed;
  const action = form.get('action');
  if (action === 'deny') {
    return Response.redirect(authorizeRedirect(req.redirectUri, origin, req.state, { error: 'access_denied', description: 'The shopper declined.' }), 303);
  }

  let user: SessionUser | null = null;
  const headers = new Headers();
  if (action === 'google') {
    let result;
    try {
      result = await verifyGoogleIdToken(form.get('credential'), config.googleClientId);
    } catch (err: unknown) {
      console.error('[api/oauth] Google keys unavailable', err instanceof Error ? err.message : err);
      return page(consentPage({ origin, client: parsed.client, request: req, params, user: null, config, error: "Couldn't reach Google. Try again." }), 503);
    }
    if (!result.ok) return page(consentPage({ origin, client: parsed.client, request: req, params, user: null, config, error: "Google didn't confirm this sign-in. Try again." }), 401);
    user = result.identity;
    headers.append('Set-Cookie', sessionCookie(user, config.sessionSecret)); // signed in on the website too
  } else if (action === 'continue') {
    user = readSession(request, config.sessionSecret);
    const csrf = readToken(form.get('csrf'), config.sessionSecret, 'csrf');
    if (!user || !csrf || csrf.sub !== user.sub || csrf.cc !== requestDigest(req)) {
      return page(consentPage({ origin, client: parsed.client, request: req, params, user: null, config, error: 'Your session ran out. Sign in again.' }), 401);
    }
  } else {
    return page(errorPage('Unknown action.'), 400);
  }

  headers.set('Location', authorizeRedirect(req.redirectUri, origin, req.state, { code: issueCode(user, req, config.sessionSecret) }));
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
}

// ---- Token endpoint ----

function tokenError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status, { ...CORS, Pragma: 'no-cache' });
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(data).filter(([, v]) => typeof v === 'string') as [string, string][]);
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

async function token(request: Request, origin: string, config: BillingConfig & { sessionSecret: string }): Promise<Response> {
  const form = await readForm(request);
  // Public clients only (token_endpoint_auth_methods_supported: ["none"]): a client secret or assertion is refused.
  if (request.headers.get('authorization') || form.get('client_assertion') || form.get('client_secret')) {
    return tokenError('invalid_client', 'This server accepts public clients only (PKCE, no client authentication).', 401);
  }
  const clientId = form.get('client_id');
  const grant = form.get('grant_type');
  const resource = form.get('resource');

  if (grant === 'authorization_code') {
    const claims = readToken(form.get('code'), config.sessionSecret, 'code');
    if (!claims || !claims.jti) return tokenError('invalid_grant', 'The code is invalid or expired.');
    if (claims.cid !== clientId) return tokenError('invalid_grant', 'The code was issued to another client.');
    if (claims.ru !== form.get('redirect_uri')) return tokenError('invalid_grant', 'The redirect URI does not match.');
    if (resource && resource !== claims.aud && resource !== origin) return tokenError('invalid_target', 'Unknown resource.');
    if (!pkceOk(form.get('code_verifier'), claims.cc)) return tokenError('invalid_grant', 'PKCE verification failed.');
    try {
      if (!(await ledger().once(`oauth-code:${claims.jti}`, CODE_TTL_S * 2))) return tokenError('invalid_grant', 'The code was already used.');
    } catch (err: unknown) {
      console.error('[api/oauth] ledger failed', err instanceof Error ? err.message : err);
      return tokenError('temporarily_unavailable', 'Try again in a moment.', 503);
    }
    return json(issueTokens(claims, claims.aud!, claims.cid!, config.sessionSecret), 200, { ...CORS, Pragma: 'no-cache' });
  }

  if (grant === 'refresh_token') {
    const claims = readToken(form.get('refresh_token'), config.sessionSecret, 'refresh');
    if (!claims) return tokenError('invalid_grant', 'The refresh token is invalid or expired.');
    if (clientId && claims.cid !== clientId) return tokenError('invalid_grant', 'The refresh token was issued to another client.');
    if (resource && resource !== claims.aud && resource !== origin) return tokenError('invalid_target', 'Unknown resource.');
    return json(issueTokens(claims, claims.aud!, claims.cid!, config.sessionSecret), 200, { ...CORS, Pragma: 'no-cache' });
  }
  return tokenError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// ---- Pages ----

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(body: string, status = 200): Response {
  return new Response(body, { status, headers: PAGE_HEADERS });
}

const STYLE = `
:root{--paper:#fff;--bone:#f4f1ec;--hairline:#d6d1c8;--ink:#111;--graphite:#3a3835;--muted:#6f6a63;--sale:#8e2a21;--serif:'Cormorant Garamond','Times New Roman',serif;--sans:Inter,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bone);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:440px;margin:48px auto;padding:24px;background:var(--paper);border:1px solid var(--hairline);display:flex;flex-direction:column;gap:16px}
.wordmark{font:500 28px/1 var(--serif)}.eyebrow{font:500 10px var(--sans);letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin:0}
h1{margin:0;font:500 30px/1.1 var(--serif)}p{margin:0;font:400 14px/1.55 var(--sans);color:var(--graphite)}.note{font-size:12px;color:var(--muted)}.warn{color:var(--sale)}
.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 16px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);font:500 11px var(--sans);letter-spacing:.18em;text-transform:uppercase;cursor:pointer;width:100%}
.link{background:none;border:0;padding:0;font:400 12px var(--sans);color:var(--ink);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
form{margin:0}.or{font-size:12px;color:var(--muted)}a{color:var(--ink);text-underline-offset:3px}@media(max-width:520px){main{margin:0;min-height:100vh;border:0}}`;

function shell(title: string, inner: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style>${extraHead}</head><body><main><div class="wordmark">FitRoom</div>${inner}</main></body></html>`;
}

function errorPage(message: string): string {
  return shell('FitRoom', `<p class="eyebrow">Connect FitRoom</p><h1>Can't connect</h1><p>${escapeHtml(message)}</p>`);
}

interface ConsentProps {
  origin: string;
  client: OAuthClient;
  request: AuthorizeRequest;
  params: URLSearchParams;
  user: SessionUser | null;
  config: BillingConfig & { sessionSecret: string; googleClientId: string };
  error?: string;
}

function hiddenFields(params: URLSearchParams): string {
  return AUTHORIZE_FIELDS.map((k) => {
    const v = params.get(k);
    return v === null ? '' : `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`;
  }).join('');
}

function consentPage({ client, request, params, user, config, error }: ConsentProps): string {
  const name = escapeHtml(client.name);
  const fields = hiddenFields(params);
  const free = config.freeLooks;
  const csrf = user ? signToken({ k: 'csrf', sub: user.sub, em: user.email, cc: requestDigest(request), exp: expiresIn(CSRF_TTL_S) }, config.sessionSecret) : '';
  const continueForm = user
    ? `<form method="post"><input type="hidden" name="action" value="continue"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${fields}
<button class="btn" type="submit">Continue as ${escapeHtml(user.email)}</button></form><p class="or">Or use another Google account:</p>`
    : '<p class="or">Sign in with the Google account you use on FitRoom (or a new one):</p>';
  const google = `<form method="post" id="google-form"><input type="hidden" name="action" value="google"><input type="hidden" name="credential" id="credential">${fields}</form>
<div id="g_id_onload" data-client_id="${escapeHtml(config.googleClientId)}" data-callback="onGoogle" data-auto_prompt="false"></div>
<div class="g_id_signin" data-type="standard" data-theme="outline" data-size="large" data-text="signin_with" data-shape="rectangular" data-width="260"></div>`;
  const deny = `<form method="post"><input type="hidden" name="action" value="deny">${fields}<button class="link" type="submit">Cancel</button></form>`;
  const freeLine = free > 0 ? `Every FitRoom account gets ${free} free try-on${free === 1 ? '' : 's'}; ` : '';
  const inner = `<p class="eyebrow">Connect to ${name}</p><h1>Use FitRoom in ${name}</h1>
<p>${name} will try clothes on your own photos with your FitRoom try-ons. ${freeLine}try-ons you have on the FitRoom website work here too.</p>
${error ? `<p class="warn" role="alert">${escapeHtml(error)}</p>` : ''}
${continueForm}${google}
<p class="note">FitRoom never stores your photos. It keeps your Google account id, email and how many try-ons you have used. <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a></p>${deny}`;
  const head = `<script src="https://accounts.google.com/gsi/client" async></script><script>function onGoogle(r){if(!r||!r.credential)return;document.getElementById('credential').value=r.credential;document.getElementById('google-form').submit();}</script>`;
  return shell(`Connect FitRoom to ${client.name}`, inner, head);
}
