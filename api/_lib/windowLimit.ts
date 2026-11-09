// Fixed-window request counter per key (e.g. per IP). In memory, so per warm Vercel instance: best effort,
// enough to stop one client from hammering an upstream through us.

export type LimitVerdict = { ok: true } | { ok: false; retryAfterS: number };

export interface WindowLimiter {
  hit(key: string, now?: number): LimitVerdict;
}

export interface WindowLimiterOptions {
  limit: number;
  windowMs: number;
  /** Bound on tracked keys; the table resets when exceeded. */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 5000;

export function createWindowLimiter({ limit, windowMs, maxKeys = DEFAULT_MAX_KEYS }: WindowLimiterOptions): WindowLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key: string, now: number = Date.now()): LimitVerdict {
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        if (!current && windows.size >= maxKeys) windows.clear();
        windows.set(key, { start: now, count: 1 });
        return { ok: true };
      }
      if (current.count >= limit) {
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((current.start + windowMs - now) / 1000)) };
      }
      windows.set(key, { start: current.start, count: current.count + 1 });
      return { ok: true };
    },
  };
}
