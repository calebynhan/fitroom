import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PHOTOREAL_LIMIT = 5; // per visitor (signed cookie)
export const IP_CEILING = 25; // per IP, high enough for shared venue wifi
export const IP_CONCURRENCY = 3; // generations in flight per IP
const DEFAULT_INSTANCE_DAILY_CAP = 100; // per warm instance; override with PHOTOREAL_DAILY_CAP
export const COOKIE_NAME = 'fr_pr';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// In-memory counters are per warm instance (best effort); the signed cookie is the per-visitor limit.
const ipCounts = new Map<string, number>();
const inFlight = new Map<string, number>();
let instanceDay = { start: Date.now(), count: 0 };

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

function instanceCount(): number {
  if (Date.now() - instanceDay.start > DAY_MS) instanceDay = { start: Date.now(), count: 0 };
  return instanceDay.count;
}

export interface Usage {
  used: number; // this visitor's successful shots
  ip: string;
}

export type Verdict = { ok: true } | { ok: false; status: number; error: string };

export function currentUsage(request: Request, secret: string): Usage {
  return { used: decodeCount(readCookie(request.headers.get('cookie'), COOKIE_NAME), secret), ip: clientIp(request) };
}

/** Decides whether this visitor may start a shot right now. */
export function check(usage: Usage): Verdict {
  if (process.env.PHOTOREAL_DISABLED === '1') return { ok: false, status: 503, error: 'Photoreal is paused right now.' };
  if (usage.used >= PHOTOREAL_LIMIT) {
    return { ok: false, status: 429, error: `You have used all ${PHOTOREAL_LIMIT} photoreal shots. Thanks for trying FitRoom!` };
  }
  if ((ipCounts.get(usage.ip) ?? 0) >= IP_CEILING || instanceCount() >= instanceCap()) {
    return { ok: false, status: 429, error: 'FitRoom has made a lot of photos today. Try again later.' };
  }
  if ((inFlight.get(usage.ip) ?? 0) >= IP_CONCURRENCY) {
    return { ok: false, status: 429, error: 'A few photos are already developing. One moment.' };
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

/** Records one billed shot; returns the Set-Cookie header value. */
export function recordUse(usage: Usage, secret: string): string {
  ipCounts.set(usage.ip, (ipCounts.get(usage.ip) ?? 0) + 1);
  instanceCount();
  instanceDay.count += 1;
  return `${COOKIE_NAME}=${encodeCount(usage.used + 1, secret)}; Path=/api; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax; Secure`;
}
