// The signed-in person, as a signed cookie: { Google account id, email, expiry }, HMAC'd with SESSION_SECRET. No
// session store; signing out clears the cookie. HttpOnly + SameSite=Lax, so pages can't read it and other sites'
// forms can't post with it.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readCookie } from './rateLimit';

export const SESSION_COOKIE = 'fr_session';
export const SESSION_TTL_S = 60 * 60 * 24 * 30;
const MAX_EMAIL_CHARS = 254;

export interface SessionUser {
  /** Google's stable account id (the ID token's `sub`). */
  sub: string;
  email: string;
}

function key(secret: string): Buffer {
  return createHash('sha256').update(`fitroom-session:${secret}`).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(payload).digest('base64url');
}

export function encodeSession(user: SessionUser, secret: string, now: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ s: user.sub, e: user.email, x: Math.floor(now / 1000) + SESSION_TTL_S })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The user in a session cookie value, or null if it is missing, forged, malformed or expired. */
export function decodeSession(value: string | undefined, secret: string, now: number = Date.now()): SessionUser | null {
  const [payload, sig, extra] = value?.split('.') ?? [];
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; e?: unknown; x?: unknown };
    if (typeof data.s !== 'string' || !data.s || typeof data.e !== 'string' || !data.e || data.e.length > MAX_EMAIL_CHARS) return null;
    if (typeof data.x !== 'number' || data.x * 1000 <= now) return null;
    return { sub: data.s, email: data.e };
  } catch {
    return null;
  }
}

export function readSession(request: Request, secret: string | null): SessionUser | null {
  if (!secret) return null;
  return decodeSession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), secret);
}

export function sessionCookie(user: SessionUser, secret: string, now: number = Date.now()): string {
  return `${SESSION_COOKIE}=${encodeSession(user, secret, now)}; Path=/api; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}
