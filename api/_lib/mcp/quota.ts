// Free try-on photos in ChatGPT: TRYON_FREE_PER_MONTH (default 5) outfit photos per person per calendar month, and
// TRYON_DAILY_CAP (default 100) for everyone together per UTC day, which bounds spend. The person is ChatGPT's
// anonymised user id (`openai/subject`), hashed before it is used as a key; no FitRoom account.
// Counters live in the plugin's store (store.ts): Upstash Redis when configured, else memory per warm instance.
import { createHash } from 'node:crypto';
import type { Store } from './store';

export { memoryStore, storeFromEnv, upstashStore } from './store';

type Env = Record<string, string | undefined>;

/** The quota only needs counters; any Store (store.ts) is one. */
export type QuotaStore = Pick<Store, 'incr'>;

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function limitsFromEnv(env: Env = process.env): { perMonth: number; perDay: number } {
  return { perMonth: positive(env.TRYON_FREE_PER_MONTH, 5), perDay: positive(env.TRYON_DAILY_CAP, 100) };
}

/** "subject:<hash>" from ChatGPT's anonymised user id; the conversation id, then the IP, when there is none. */
export function userKey(meta: Record<string, unknown> | undefined, ip: string): string {
  const pick = (k: string) => (typeof meta?.[k] === 'string' && (meta[k] as string).trim() ? (meta[k] as string) : null);
  const subject = pick('openai/subject');
  const [kind, id] = subject ? ['u', subject] : pick('openai/session') ? ['s', pick('openai/session')!] : ['ip', ip];
  return `${kind}:${createHash('sha256').update(`fitroom-tryon:${id}`).digest('base64url').slice(0, 22)}`;
}

export type Reservation =
  | { ok: true; used: number; remaining: number; resetsAt: string; release: () => Promise<void> }
  | { ok: false; reason: 'user' | 'everyone' | 'store'; remaining: number; resetsAt: string };

function monthKey(t: Date): string {
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Takes one free photo for this person (and from today's shared cap); `release` gives it back if nothing was made. */
export async function reserve(
  store: QuotaStore,
  user: string,
  limits: { perMonth: number; perDay: number },
  now: number = Date.now(),
): Promise<Reservation> {
  const t = new Date(now);
  const resetsAt = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)).toISOString();
  const userK = `fr:tryon:${monthKey(t)}:${user}`;
  const dayK = `fr:tryon:day:${t.toISOString().slice(0, 10)}`;
  try {
    const used = await store.incr(userK, 1, 32 * 24 * 3600);
    if (used > limits.perMonth) {
      await store.incr(userK, -1, 32 * 24 * 3600);
      return { ok: false, reason: 'user', remaining: 0, resetsAt };
    }
    const today = await store.incr(dayK, 1, 2 * 24 * 3600);
    if (today > limits.perDay) {
      await Promise.all([store.incr(dayK, -1, 2 * 24 * 3600), store.incr(userK, -1, 32 * 24 * 3600)]);
      return { ok: false, reason: 'everyone', remaining: limits.perMonth - used + 1, resetsAt };
    }
    let released = false;
    return {
      ok: true,
      used,
      remaining: limits.perMonth - used,
      resetsAt,
      release: async () => {
        if (released) return;
        released = true;
        await Promise.all([store.incr(dayK, -1, 2 * 24 * 3600), store.incr(userK, -1, 32 * 24 * 3600)]).catch((err: unknown) =>
          console.error('[mcp] quota release failed', err instanceof Error ? err.message : err),
        );
      },
    };
  } catch (err: unknown) {
    console.error('[mcp] quota store failed', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'store', remaining: 0, resetsAt };
  }
}

export type DailyReservation =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; reason: 'everyone' | 'store' };

/**
 * Takes one photo from today's shared cap only (paid try-ons on: the person's own count is their FitRoom account, in
 * the ledger). The cap still bounds what FitRoom spends on FASHN in a day.
 */
export async function reserveDaily(store: QuotaStore, limits: { perDay: number }, now: number = Date.now()): Promise<DailyReservation> {
  const dayK = `fr:tryon:day:${new Date(now).toISOString().slice(0, 10)}`;
  try {
    const today = await store.incr(dayK, 1, 2 * 24 * 3600);
    if (today > limits.perDay) {
      await store.incr(dayK, -1, 2 * 24 * 3600);
      return { ok: false, reason: 'everyone' };
    }
    let released = false;
    return {
      ok: true,
      release: async () => {
        if (released) return;
        released = true;
        await store.incr(dayK, -1, 2 * 24 * 3600).catch((err: unknown) => console.error('[mcp] daily cap release failed', err instanceof Error ? err.message : err));
      },
    };
  } catch (err: unknown) {
    console.error('[mcp] quota store failed', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'store' };
  }
}
