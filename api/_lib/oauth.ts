// FitRoom as an OAuth 2.1 authorization server for ChatGPT plugins (MCP authorization spec): the shopper links their
// FitRoom account (their Google sign-in) to ChatGPT, so try-ons in ChatGPT use the same looks as the website.
// - Clients identify themselves with Client ID Metadata Documents (CIMD): the client_id is an HTTPS URL on an allowed
//   host (chatgpt.com, openai.com), whose JSON lists its redirect URIs. Public clients only (PKCE S256, no secret).
// - Codes, access and refresh tokens are HMAC-signed with SESSION_SECRET (no token store); a code works once (ledger).
// - Authorization responses carry `iss` (RFC 9207); access tokens carry the MCP resource as their audience.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPE = 'tryon';
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 60 * 24 * 60 * 60;
export const CSRF_TTL_S = 15 * 60;
const CLIENT_CACHE_MS = 60 * 60 * 1000;
const CLIENT_FETCH_MS = 5000;
const CLIENT_DOC_MAX_CHARS = 64 * 1024;
const DEFAULT_CLIENT_HOSTS = ['chatgpt.com', 'openai.com'];

export const mcpResource = (origin: string) => `${origin}/mcp`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

/** RFC 9728: where ChatGPT learns which authorization server guards /mcp. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'FitRoom',
    resource_documentation: `${origin}/try-ons.html`,
    resource_policy_uri: `${origin}/privacy.html`,
  };
}

/** RFC 8414: how to run the authorization-code + PKCE flow against FitRoom. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [SCOPE],
    service_documentation: `${origin}/try-ons.html`,
    op_policy_uri: `${origin}/privacy.html`,
  };
}

// ---- Signed tokens ----

export type TokenKind = 'code' | 'access' | 'refresh' | 'csrf';

export interface Claims {
  k: TokenKind;
  /** Google account id and email: the FitRoom account. */
  sub: string;
  em: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
  /** Audience: the MCP resource (code, access, refresh). */
  aud?: string;
  /** OAuth client id (code, access, refresh). */
  cid?: string;
  scope?: string;
  /** Code only: redirect URI and PKCE challenge. CSRF only: digest of the authorization request. */
  ru?: string;
  cc?: string;
  /** Unique id (codes are single-use by it). */
  jti?: string;
}

const PREFIX = 'fr1';

function key(secret: string): Buffer {
  return createHash('sha256').update(`fitroom-oauth:${secret}`).digest();
}

function mac(data: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(data).digest('base64url');
}

export function signToken(claims: Claims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${PREFIX}.${payload}.${mac(`${PREFIX}.${payload}`, secret)}`;
}

/** The claims of a genuine, unexpired token of `kind`, else null. */
export function readToken(token: unknown, secret: string, kind: TokenKind, now: number = Date.now()): Claims | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [prefix, payload, sig, extra] = token.split('.');
  if (prefix !== PREFIX || !payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(`${PREFIX}.${payload}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
    if (claims.k !== kind || typeof claims.sub !== 'string' || typeof claims.em !== 'string' || typeof claims.exp !== 'number') return null;
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

export const newId = () => randomBytes(16).toString('base64url');
export const expiresIn = (seconds: number, now: number = Date.now()) => Math.floor(now / 1000) + seconds;

/** PKCE S256: base64url(SHA-256(verifier)) === challenge, with a well-formed verifier (RFC 7636). */
export function pkceOk(verifier: unknown, challenge: string | undefined): boolean {
  if (typeof verifier !== 'string' || !challenge || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const expected = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- Clients (CIMD) ----

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}

export function clientHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = env.OAUTH_CLIENT_HOSTS?.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return listed?.length ? listed : DEFAULT_CLIENT_HOSTS;
}

/** True when `clientId` is an HTTPS URL on an allowed host (or the host's subdomain). Off Vercel, http://localhost too. */
export function clientIdAllowed(clientId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (!env.VERCEL && url.protocol === 'http:' && url.hostname === 'localhost') return true;
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return clientHosts(env).some((h) => host === h || host.endsWith(`.${h}`));
}

const clients = new Map<string, { client: OAuthClient; until: number }>();

/** Forgets fetched client documents (tests). */
export function resetClients(): void {
  clients.clear();
}

/** The client behind a CIMD client_id, fetched from that URL (cached for an hour); null if it isn't one we accept. */
export async function loadClient(clientId: unknown, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<OAuthClient | null> {
  if (typeof clientId !== 'string' || clientId.length > 2048 || !clientIdAllowed(clientId, env)) return null;
  const cached = clients.get(clientId);
  if (cached && cached.until > now) return cached.client;
  let doc: Record<string, unknown>;
  try {
    const res = await fetch(clientId, { redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CLIENT_FETCH_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > CLIENT_DOC_MAX_CHARS) return null;
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch (err: unknown) {
    console.warn('[oauth] client document unavailable', clientId, err instanceof Error ? err.message : err);
    return null;
  }
  if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
  const redirectUris = doc.redirect_uris.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u));
  if (redirectUris.length === 0) return null;
  const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim().slice(0, 60) : new URL(clientId).hostname;
  const client = { id: clientId, name, redirectUris };
  if (clients.size > 100) clients.clear();
  clients.set(clientId, { client, until: now + CLIENT_CACHE_MS });
  return client;
}

// ---- Authorization requests ----

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string;
}

export const AUTHORIZE_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const;

export type ParsedAuthorize =
  | { ok: true; request: AuthorizeRequest; client: OAuthClient }
  /** `redirect` false: the client or redirect URI can't be trusted, so show the error instead of sending it there. */
  | { ok: false; redirect: false; message: string }
  | { ok: false; redirect: true; redirectUri: string; state: string | null; error: string; description: string };

/** Checks an authorization request (RFC 6749 4.1.1 + PKCE + resource indicators). */
export async function parseAuthorize(params: URLSearchParams, origin: string, env: NodeJS.ProcessEnv = process.env): Promise<ParsedAuthorize> {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const client = await loadClient(clientId, env);
  if (!client) return { ok: false, redirect: false, message: "This app isn't allowed to connect to FitRoom." };
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, redirect: false, message: "This app's return address doesn't match its registration." };
  const state = params.get('state');
  const fail = (error: string, description: string): ParsedAuthorize => ({ ok: false, redirect: true, redirectUri, state, error, description });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only the authorization code flow is supported.');
  const codeChallenge = params.get('code_challenge') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || params.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request', 'PKCE with S256 is required.');
  }
  const resource = params.get('resource') ?? mcpResource(origin);
  if (resource !== mcpResource(origin) && resource !== origin) return fail('invalid_target', 'Unknown resource.');
  if (state !== null && state.length > 1024) return fail('invalid_request', 'State is too long.');
  return { ok: true, client, request: { clientId, redirectUri, state, codeChallenge, scope: SCOPE, resource: mcpResource(origin) } };
}

/** Where the browser goes after the shopper approves (code) or declines (error), with `iss` (RFC 9207). */
export function authorizeRedirect(redirectUri: string, origin: string, state: string | null, result: { code: string } | { error: string; description?: string }): string {
  const url = new URL(redirectUri);
  if ('code' in result) url.searchParams.set('code', result.code);
  else {
    url.searchParams.set('error', result.error);
    if (result.description) url.searchParams.set('error_description', result.description);
  }
  if (state !== null) url.searchParams.set('state', state);
  url.searchParams.set('iss', origin);
  return url.toString();
}

/** Digest of an authorization request, so a consent form can only approve the request it was shown for. */
export function requestDigest(r: AuthorizeRequest): string {
  return createHash('sha256').update(JSON.stringify([r.clientId, r.redirectUri, r.state, r.codeChallenge, r.resource])).digest('base64url');
}

export function issueCode(user: { sub: string; email: string }, r: AuthorizeRequest, secret: string, now: number = Date.now()): string {
  return signToken(
    { k: 'code', sub: user.sub, em: user.email, aud: r.resource, cid: r.clientId, scope: r.scope, ru: r.redirectUri, cc: r.codeChallenge, jti: newId(), exp: expiresIn(CODE_TTL_S, now) },
    secret,
  );
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export function issueTokens(user: { sub: string; em: string }, aud: string, cid: string, secret: string, now: number = Date.now()): TokenSet {
  const base = { sub: user.sub, em: user.em, aud, cid, scope: SCOPE };
  return {
    access_token: signToken({ k: 'access', ...base, jti: newId(), exp: expiresIn(ACCESS_TTL_S, now) }, secret),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: signToken({ k: 'refresh', ...base, jti: newId(), exp: expiresIn(REFRESH_TTL_S, now) }, secret),
    scope: SCOPE,
  };
}

/** The account behind a request's bearer token: none, a genuine one for this MCP server, or invalid (expired, forged). */
export function bearerUser(request: Request, origin: string, secret: string | null, now: number = Date.now()):
  | { status: 'none' }
  | { status: 'ok'; user: { sub: string; email: string } }
  | { status: 'invalid' } {
  const header = request.headers.get('authorization');
  if (!header) return { status: 'none' };
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match || !secret) return { status: 'invalid' };
  const claims = readToken(match[1], secret, 'access', now);
  if (!claims || claims.aud !== mcpResource(origin)) return { status: 'invalid' };
  return { status: 'ok', user: { sub: claims.sub, email: claims.em } };
}

/** The WWW-Authenticate challenge that sends ChatGPT to link the account. */
export function authChallenge(origin: string, error = 'invalid_token', description = 'Sign in to FitRoom to try clothes on.'): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(origin)}", scope="${SCOPE}", error="${error}", error_description="${description.replace(/"/g, "'")}"`;
}
