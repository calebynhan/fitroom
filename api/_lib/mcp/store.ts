// Shared storage for the ChatGPT plugin: counters (try-on quota), hashes (usage metrics, fit reports) and HyperLogLogs
// (distinct users, from hashed ids). Upstash Redis over REST when UPSTASH_REDIS_REST_URL + _TOKEN (or Vercel KV's
// KV_REST_API_URL + _TOKEN) are set, so every instance sees the same numbers; otherwise in memory per warm instance
// (best effort: fine for dev and tests, not for production counts).

type Env = Record<string, string | undefined>;

export interface Store {
  readonly kind: 'upstash' | 'memory';
  /** Adds `by` to a counter (TTL refreshed) and returns the new value. Throws when the store is unreachable. */
  incr(key: string, by: number, ttlS: number): Promise<number>;
  /** Adds `by` to one field of a hash (TTL refreshed) and returns the field's new value. */
  hincr(key: string, field: string, by: number, ttlS: number): Promise<number>;
  /** Every field of a hash as numbers ({} when missing). */
  hgetall(key: string): Promise<Record<string, number>>;
  /** Adds a member to a distinct-count set (TTL refreshed). */
  pfadd(key: string, member: string, ttlS: number): Promise<void>;
  /** Distinct members across these sets. */
  pfcount(keys: string[]): Promise<number>;
}

export function memoryStore(now: () => number = Date.now): Store {
  const data = new Map<string, { value: number | Map<string, number> | Set<string>; expires: number }>();
  const live = <T>(key: string, make: () => T): T => {
    const hit = data.get(key);
    if (hit && hit.expires > now()) return hit.value as T;
    const value = make();
    if (data.size > 50_000) data.clear();
    data.set(key, { value: value as never, expires: Number.POSITIVE_INFINITY });
    return value;
  };
  const touch = (key: string, ttlS: number) => {
    const hit = data.get(key);
    if (hit) hit.expires = now() + ttlS * 1000;
  };
  return {
    kind: 'memory',
    async incr(key, by, ttlS) {
      const value = (live<number>(key, () => 0) as number) + by;
      data.set(key, { value, expires: now() + ttlS * 1000 });
      return value;
    },
    async hincr(key, field, by, ttlS) {
      const hash = live(key, () => new Map<string, number>());
      const value = (hash.get(field) ?? 0) + by;
      hash.set(field, value);
      touch(key, ttlS);
      return value;
    },
    async hgetall(key) {
      const hit = data.get(key);
      if (!hit || hit.expires <= now() || !(hit.value instanceof Map)) return {};
      return Object.fromEntries(hit.value);
    },
    async pfadd(key, member, ttlS) {
      live(key, () => new Set<string>()).add(member);
      touch(key, ttlS);
    },
    async pfcount(keys) {
      const all = new Set<string>();
      for (const key of keys) {
        const hit = data.get(key);
        if (hit && hit.expires > now() && hit.value instanceof Set) hit.value.forEach((m) => all.add(m));
      }
      return all.size;
    },
  };
}

type Reply = { result?: unknown; error?: string };

export function upstashStore(url: string, token: string, fetchImpl: typeof fetch = fetch): Store {
  const base = url.replace(/\/+$/, '');
  const run = async (commands: string[][]): Promise<unknown[]> => {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const out = (await res.json()) as Reply[];
    if (!Array.isArray(out)) throw new Error('upstash bad reply');
    const failed = out.find((r) => r?.error);
    if (failed) throw new Error(`upstash ${failed.error}`);
    return out.map((r) => r?.result);
  };
  const int = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error('upstash bad reply');
    return n;
  };
  return {
    kind: 'upstash',
    async incr(key, by, ttlS) {
      const [value] = await run([
        ['INCRBY', key, String(by)],
        ['EXPIRE', key, String(ttlS)],
      ]);
      return int(value);
    },
    async hincr(key, field, by, ttlS) {
      const [value] = await run([
        ['HINCRBY', key, field, String(by)],
        ['EXPIRE', key, String(ttlS)],
      ]);
      return int(value);
    },
    async hgetall(key) {
      const [flat] = await run([['HGETALL', key]]);
      const out: Record<string, number> = {};
      if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = Number(flat[i + 1]) || 0;
      return out;
    },
    async pfadd(key, member, ttlS) {
      await run([
        ['PFADD', key, member],
        ['EXPIRE', key, String(ttlS)],
      ]);
    },
    async pfcount(keys) {
      if (keys.length === 0) return 0;
      const [value] = await run([['PFCOUNT', ...keys]]);
      return int(value);
    },
  };
}

let defaultStore: Store | null = null;

export function storeFromEnv(env: Env = process.env): Store {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return upstashStore(url, token);
  defaultStore ??= memoryStore();
  return defaultStore;
}

/** "2026-11-11" (UTC). */
export function dayOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
