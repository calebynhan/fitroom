// The looks ledger: per person (Google account id), free looks used, paid looks left, and which looks were charged (so
// the same look never costs twice: Try On Again, a retry, the side photo). Shared by every server instance through
// Upstash Redis (Vercel Marketplace "Upstash for Redis": KV_REST_API_URL + KV_REST_API_TOKEN), each change one atomic
// Lua script. Off Vercel (vite dev, tests) an in-memory ledger stands in. Holds account ids, emails and counts only.
import type { Balance } from './accountTypes';

/** How a charge was paid: a free look, a paid one, or not at all ('repeat' = this look was already charged). */
export type ChargeSource = 'free' | 'paid' | 'repeat';
export type ChargeResult = { ok: true; source: ChargeSource; balance: Balance } | { ok: false; balance: Balance };
/** 'none': this look was never charged; 'late': charged too long ago to give back. */
export type RefundResult = { refunded: boolean; reason?: 'none' | 'late'; balance: Balance };

export interface Ledger {
  balance(sub: string): Promise<Balance>;
  /** Charges one look unless `look` was charged before. Free looks go first, then paid ones. */
  charge(sub: string, email: string, look: string, freeLooks: number, now?: number): Promise<ChargeResult>;
  /** Gives a look back (it produced no photo), if it was charged within REFUND_WINDOW_MS. */
  refund(sub: string, look: string, now?: number): Promise<RefundResult>;
  /** Adds `looks` paid looks once per `payment` (a Stripe Checkout session id), however often it is reported. */
  credit(sub: string, email: string, payment: string, looks: number): Promise<{ credited: boolean; balance: Balance }>;
}

/** A look can be given back this long after it was charged (a try-on gives up after 10 minutes). */
export const REFUND_WINDOW_MS = 15 * 60 * 1000;
/** Charged looks are remembered this long (re-shooting one within it is free). */
export const LOOK_MEMORY_S = 60 * 60 * 24 * 90;
const PAYMENT_MEMORY_S = 60 * 60 * 24 * 400;
const TIMEOUT_MS = 5000;

// One hash tag per person, so every key a script touches lives in the same slot.
export const userKey = (sub: string) => `fr:{${sub}}:user`;
export const looksKey = (sub: string) => `fr:{${sub}}:looks`;
export const paymentKey = (sub: string, payment: string) => `fr:{${sub}}:paid:${payment}`;

// KEYS: user, looks. ARGV: look, freeLooks, now, email, lookMemoryS. Returns { source | 'empty', freeUsed, credits }.
export const CHARGE_LUA = `
local free = tonumber(redis.call('HGET', KEYS[1], 'free') or '0')
local credits = tonumber(redis.call('HGET', KEYS[1], 'credits') or '0')
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return {'repeat', free, credits} end
local source
if free < tonumber(ARGV[2]) then
  source = 'free'
  free = redis.call('HINCRBY', KEYS[1], 'free', 1)
elseif credits > 0 then
  source = 'paid'
  credits = redis.call('HINCRBY', KEYS[1], 'credits', -1)
else
  return {'empty', free, credits}
end
redis.call('HSET', KEYS[2], ARGV[1], source .. ':' .. ARGV[3])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
redis.call('HSET', KEYS[1], 'email', ARGV[4])
return {source, free, credits}
`;

// KEYS: user, looks. ARGV: look, now, windowMs. Returns { 'free' | 'paid' | 'none' | 'late', freeUsed, credits }.
export const REFUND_LUA = `
local free = tonumber(redis.call('HGET', KEYS[1], 'free') or '0')
local credits = tonumber(redis.call('HGET', KEYS[1], 'credits') or '0')
local prior = redis.call('HGET', KEYS[2], ARGV[1])
if not prior then return {'none', free, credits} end
local source, at = string.match(prior, '^(%a+):(%d+)$')
if not source or tonumber(ARGV[2]) - tonumber(at) > tonumber(ARGV[3]) then return {'late', free, credits} end
redis.call('HDEL', KEYS[2], ARGV[1])
if source == 'free' then
  free = redis.call('HINCRBY', KEYS[1], 'free', -1)
elseif source == 'paid' then
  credits = redis.call('HINCRBY', KEYS[1], 'credits', 1)
end
return {source, free, credits}
`;

// KEYS: user, payment. ARGV: looks, email, paymentMemoryS. Returns { 1 | 0, freeUsed, credits }.
export const CREDIT_LUA = `
local credited = 0
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', tonumber(ARGV[3])) then
  redis.call('HINCRBY', KEYS[1], 'credits', tonumber(ARGV[1]))
  redis.call('HINCRBY', KEYS[1], 'bought', tonumber(ARGV[1]))
  redis.call('HSET', KEYS[1], 'email', ARGV[2])
  credited = 1
end
return {credited, tonumber(redis.call('HGET', KEYS[1], 'free') or '0'), tonumber(redis.call('HGET', KEYS[1], 'credits') or '0')}
`;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toBalance = (free: unknown, credits: unknown): Balance => ({ freeUsed: num(free), credits: num(credits) });

export class LedgerError extends Error {}

/** Runs Redis commands over Upstash's REST API (one command per request; scripts keep each change atomic). */
export function upstashLedger(url: string, token: string): Ledger {
  const base = url.replace(/\/+$/, '');
  async function command(args: (string | number)[]): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: unknown) {
      throw new LedgerError(`ledger unreachable: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    const data = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !data || data.error) throw new LedgerError(`ledger error: HTTP ${res.status} ${data?.error ?? ''}`.trim());
    return data.result;
  }
  const script = async (lua: string, keys: string[], args: (string | number)[]) =>
    (await command(['EVAL', lua, keys.length, ...keys, ...args])) as unknown[];

  return {
    async balance(sub) {
      const [free, credits] = (await command(['HMGET', userKey(sub), 'free', 'credits'])) as unknown[];
      return toBalance(free, credits);
    },
    async charge(sub, email, look, freeLooks, now = Date.now()) {
      const [source, free, credits] = await script(CHARGE_LUA, [userKey(sub), looksKey(sub)], [look, freeLooks, now, email, LOOK_MEMORY_S]);
      const balance = toBalance(free, credits);
      return source === 'empty' ? { ok: false, balance } : { ok: true, source: source as ChargeSource, balance };
    },
    async refund(sub, look, now = Date.now()) {
      const [source, free, credits] = await script(REFUND_LUA, [userKey(sub), looksKey(sub)], [look, now, REFUND_WINDOW_MS]);
      const balance = toBalance(free, credits);
      return source === 'none' || source === 'late' ? { refunded: false, reason: source, balance } : { refunded: true, balance };
    },
    async credit(sub, email, payment, looks) {
      const [credited, free, credits] = await script(CREDIT_LUA, [userKey(sub), paymentKey(sub, payment)], [looks, email, PAYMENT_MEMORY_S]);
      return { credited: num(credited) === 1, balance: toBalance(free, credits) };
    },
  };
}

/** The same rules in memory: one process only (vite dev, tests). */
export function memoryLedger(): Ledger {
  const users = new Map<string, { free: number; credits: number; email?: string }>();
  const looks = new Map<string, { source: 'free' | 'paid'; at: number }>();
  const payments = new Set<string>();
  const user = (sub: string) => {
    let u = users.get(sub);
    if (!u) users.set(sub, (u = { free: 0, credits: 0 }));
    return u;
  };
  const balanceOf = (sub: string): Balance => ({ freeUsed: user(sub).free, credits: user(sub).credits });
  return {
    async balance(sub) {
      return balanceOf(sub);
    },
    async charge(sub, email, look, freeLooks, now = Date.now()) {
      const u = user(sub);
      const id = `${sub}|${look}`;
      if (looks.has(id)) return { ok: true, source: 'repeat', balance: balanceOf(sub) };
      let source: 'free' | 'paid';
      if (u.free < freeLooks) {
        source = 'free';
        u.free += 1;
      } else if (u.credits > 0) {
        source = 'paid';
        u.credits -= 1;
      } else {
        return { ok: false, balance: balanceOf(sub) };
      }
      looks.set(id, { source, at: now });
      u.email = email;
      return { ok: true, source, balance: balanceOf(sub) };
    },
    async refund(sub, look, now = Date.now()) {
      const id = `${sub}|${look}`;
      const prior = looks.get(id);
      if (!prior) return { refunded: false, reason: 'none', balance: balanceOf(sub) };
      if (now - prior.at > REFUND_WINDOW_MS) return { refunded: false, reason: 'late', balance: balanceOf(sub) };
      looks.delete(id);
      if (prior.source === 'free') user(sub).free -= 1;
      else user(sub).credits += 1;
      return { refunded: true, balance: balanceOf(sub) };
    },
    async credit(sub, email, payment, n) {
      const id = `${sub}|${payment}`;
      if (payments.has(id)) return { credited: false, balance: balanceOf(sub) };
      payments.add(id);
      const u = user(sub);
      u.credits += n;
      u.email = email;
      return { credited: true, balance: balanceOf(sub) };
    },
  };
}

function upstashEnv(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Upstash when configured; in memory only off Vercel (vite dev, tests), never in a deployment. */
export function ledgerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return upstashEnv(env) !== null || !env.VERCEL;
}

let shared: { ledger: Ledger; url: string | null } | null = null;

export function ledger(env: NodeJS.ProcessEnv = process.env): Ledger {
  const upstash = upstashEnv(env);
  const url = upstash?.url ?? null;
  if (!shared || shared.url !== url) shared = { ledger: upstash ? upstashLedger(upstash.url, upstash.token) : memoryLedger(), url };
  return shared.ledger;
}

/** A fresh in-memory ledger (tests). */
export function resetLedger(): void {
  shared = null;
}
