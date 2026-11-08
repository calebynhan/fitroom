import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PHOTOREAL_LIMIT = 5;
export const COOKIE_NAME = 'fr_pr';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

// Best effort per warm instance; the signed cookie covers the rest.
const ipCounts = new Map<string, number>();
const inFlight = new Set<string>();

/** One generation at a time per IP, so parallel requests can't slip past the count. */
export function tryBegin(ip: string): boolean {
  if (inFlight.has(ip)) return false;
  inFlight.add(ip);
  return true;
}

export function end(ip: string): void {
  inFlight.delete(ip);
}

function signingKey(secret: string): Buffer {
  return createHash('sha256').update(`fitroom-cookie:${secret}`).digest();
}

function sign(count: number, secret: string): string {
  return createHmac('sha256', signingKey(secret)).update(String(count)).digest('base64url');
}

export function encodeCount(count: number, secret: string): string {
  return `${count}.${sign(count, secret)}`;
}

/** Returns the verified count from the cookie value, or 0 if missing/tampered. */
export function decodeCount(value: string | undefined, secret: string): number {
  if (!value) return 0;
  const [raw, sig] = value.split('.');
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0 || !sig) return 0;
  const expected = Buffer.from(sign(count, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? count : 0;
}

export function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export interface Usage {
  used: number;
  ip: string;
}

export function currentUsage(request: Request, secret: string): Usage {
  const ip = clientIp(request);
  const fromCookie = decodeCount(readCookie(request.headers.get('cookie'), COOKIE_NAME), secret);
  return { used: Math.max(fromCookie, ipCounts.get(ip) ?? 0), ip };
}

/** Records one more use; returns the Set-Cookie header value. */
export function recordUse(usage: Usage, secret: string): string {
  const next = usage.used + 1;
  ipCounts.set(usage.ip, next);
  return `${COOKIE_NAME}=${encodeCount(next, secret)}; Path=/api; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax; Secure`;
}
