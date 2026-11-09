import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// A look is four photos (front, three-quarter, side, back). The visitor pays one look when the front shot
// succeeds; the other three angles ride on the look token it returns (lookToken.ts).
export const LOOK_LIMIT = 3; // looks per visitor (signed cookie)
export const IP_IMAGE_CEILING = 48; // photos per IP per instance-day, high enough for shared venue wifi
export const IP_CONCURRENCY = 4; // generations in flight per IP (a look runs three angles at once)
export const PHOTOS_PER_LOOK = 4;
const BUSY_RETRY_AFTER_S = 5;
const DEFAULT_INSTANCE_DAILY_CAP = 200; // photos per warm instance per day; override with PHOTOREAL_DAILY_CAP
export const COOKIE_NAME = 'fr_looks';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// In-memory counters are per warm instance (best effort); the signed cookie is the per-visitor limit.
let day = { start: Date.now(), count: 0, ips: new Map<string, number>() };
const inFlight = new Map<string, number>();

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

function instanceCap(): number {
  const fromEnv = Number(process.env.PHOTOREAL_DAILY_CAP);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_INSTANCE_DAILY_CAP;
}

function today() {
  if (Date.now() - day.start > DAY_MS) day = { start: Date.now(), count: 0, ips: new Map() };
  return day;
}

export interface Usage {
  /** Looks this visitor has started (front shots that succeeded). */
  looks: number;
  ip: string;
}

export type Verdict = { ok: true } | { ok: false; status: number; error: string; retryable: boolean; retryAfterS?: number };

export function currentUsage(request: Request, secret: string): Usage {
  return { looks: decodeCount(readCookie(request.headers.get('cookie'), COOKIE_NAME), secret), ip: clientIp(request) };
}

export function looksLeft(usage: Usage): number {
  return Math.max(0, LOOK_LIMIT - usage.looks);
}

/**
 * Decides whether this visitor may start a photo now. `newLook` is true for the front shot, which must leave room
 * for all four photos of the look today, so nobody pays for a front whose angles can't be made.
 */
export function check(usage: Usage, newLook: boolean): Verdict {
  if (process.env.PHOTOREAL_DISABLED === '1') return { ok: false, status: 503, error: 'Photos are paused right now.', retryable: false };
  if (newLook && usage.looks >= LOOK_LIMIT) {
    return { ok: false, status: 429, error: `You have made all ${LOOK_LIMIT} looks. Thanks for trying FitRoom!`, retryable: false };
  }
  const d = today();
  const need = newLook ? PHOTOS_PER_LOOK : 1;
  if ((d.ips.get(usage.ip) ?? 0) + need > IP_IMAGE_CEILING || d.count + need > instanceCap()) {
    return { ok: false, status: 429, error: 'FitRoom has made a lot of photos today. Try again tomorrow.', retryable: false };
  }
  if ((inFlight.get(usage.ip) ?? 0) >= IP_CONCURRENCY) {
    return { ok: false, status: 429, error: 'A few photos are already developing on your network. Retry in a few seconds.', retryable: true, retryAfterS: BUSY_RETRY_AFTER_S };
  }
  return { ok: true };
}

export function begin(ip: string): void {
  inFlight.set(ip, (inFlight.get(ip) ?? 0) + 1);
}

export function end(ip: string): void {
  const n = (inFlight.get(ip) ?? 1) - 1;
  if (n <= 0) inFlight.delete(ip);
  else inFlight.set(ip, n);
}

/** Counts one billed photo toward the IP ceiling and the instance's daily cap. */
export function recordImage(ip: string): void {
  const d = today();
  d.ips.set(ip, (d.ips.get(ip) ?? 0) + 1);
  d.count += 1;
}

/** Set-Cookie header value charging this visitor one more look. */
export function lookCookie(usage: Usage, secret: string): string {
  return `${COOKIE_NAME}=${encodeCount(usage.looks + 1, secret)}; Path=/api; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax; Secure`;
}
