// Verifies a Google Sign-In ID token (the `credential` Google Identity Services gives the browser): an RS256 JWT signed
// by one of Google's published keys, for our client id, unexpired, with a verified email. Keys are fetched from Google
// and kept until their Cache-Control max-age (refetched once when a token names an unknown key: Google rotates them).
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_S = 60;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_TOKEN_CHARS = 4096;

export interface GoogleIdentity {
  sub: string;
  email: string;
}

export type VerifyResult = { ok: true; identity: GoogleIdentity } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
}

let cached: { keys: Jwk[]; expires: number } | null = null;

/** Forgets Google's keys (tests). */
export function resetGoogleKeys(): void {
  cached = null;
}

function maxAgeMs(cacheControl: string | null): number {
  const match = cacheControl?.match(/max-age=(\d+)/);
  return match ? Number(match[1]) * 1000 : DEFAULT_KEYS_TTL_MS;
}

async function googleKeys(force: boolean, now: number): Promise<Jwk[]> {
  if (!force && cached && cached.expires > now) return cached.keys;
  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cached = { keys, expires: now + maxAgeMs(res.headers.get('cache-control')) };
  return keys;
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function verifyGoogleIdToken(token: unknown, clientId: string, now: number = Date.now()): Promise<VerifyResult> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'not a token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not a JWT' };
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims) return { ok: false, reason: 'unreadable JWT' };
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'unexpected algorithm' };

  let jwk = (await googleKeys(false, now)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true, now)).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown key' };
  const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!signed) return { ok: false, reason: 'bad signature' };

  const nowS = now / 1000;
  if (!ISSUERS.has(String(claims.iss))) return { ok: false, reason: 'wrong issuer' };
  if (claims.aud !== clientId) return { ok: false, reason: 'wrong audience' };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) return { ok: false, reason: 'issued in the future' };
  if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, reason: 'no account id' };
  if (typeof claims.email !== 'string' || !claims.email) return { ok: false, reason: 'no email' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'email not verified' };
  return { ok: true, identity: { sub: claims.sub, email: claims.email } };
}
