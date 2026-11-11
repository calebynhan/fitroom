// Usage of the ChatGPT plugin, without personal data: per call the tool, its outcome, how long it took and the product
// (catalog ID) it was about; per day the distinct users, counted from hashed ChatGPT ids in a HyperLogLog (which can
// count them but never list them). No measurements, photos, sizes or conversation text are recorded.
// Read with GET /api/mcp?stats=<MCP_STATS_TOKEN> (api/mcp.ts). Counters live 90 days.
import { timingSafeEqual } from 'node:crypto';
import { dayOf, type Store } from './store';

const TTL_S = 90 * 24 * 3600;
const WRITE_BUDGET_MS = 1500;

export interface CallEvent {
  tool: string;
  outcome: string;
  ms: number;
  product?: string;
}

/** One line in the function logs plus the day's counters. Never throws, never takes more than 1.5 s. */
export async function recordCall(store: Store, user: string, event: CallEvent, now: number = Date.now(), log = true): Promise<void> {
  if (log) console.log('[mcp-event]', JSON.stringify(event));
  const day = dayOf(now);
  const writes = Promise.all([
    store.hincr(`fr:m:${day}`, `${event.tool}:${event.outcome}`, 1, TTL_S),
    store.hincr(`fr:ms:${day}`, event.tool, Math.round(event.ms), TTL_S),
    store.pfadd(`fr:u:${day}`, user, TTL_S),
    event.product ? store.hincr(`fr:p:${day}`, `${event.tool}:${event.product}`, 1, TTL_S) : null,
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, WRITE_BUDGET_MS).unref?.());
  await Promise.race([writes.catch((err: unknown) => console.error('[mcp] metrics write failed', err instanceof Error ? err.message : err)), timeout]);
}

export interface DayStats {
  day: string;
  /** Distinct ChatGPT users that day. */
  users: number;
  /** "recommend_size:ok" -> 12 */
  calls: Record<string, number>;
  /** Mean milliseconds per call, by tool. */
  meanMs: Record<string, number>;
  /** The day's most asked-about products: "recommend_size:E453754-000" -> 5, top 10. */
  products: Record<string, number>;
}

export interface Stats {
  store: Store['kind'];
  days: DayStats[];
  /** Distinct users over the last 7 days, and how many of those days the average one came back on. */
  week: { users: number; activeDaysPerUser: number };
}

export async function readStats(store: Store, days = 14, now: number = Date.now()): Promise<Stats> {
  const list = Array.from({ length: days }, (_, i) => dayOf(now - i * 24 * 3600 * 1000));
  const out: DayStats[] = [];
  for (const day of list) {
    const [users, calls, ms, products] = await Promise.all([
      store.pfcount([`fr:u:${day}`]),
      store.hgetall(`fr:m:${day}`),
      store.hgetall(`fr:ms:${day}`),
      store.hgetall(`fr:p:${day}`),
    ]);
    const perTool: Record<string, number> = {};
    for (const [key, n] of Object.entries(calls)) perTool[key.split(':')[0]] = (perTool[key.split(':')[0]] ?? 0) + n;
    const meanMs = Object.fromEntries(Object.entries(ms).map(([tool, total]) => [tool, perTool[tool] ? Math.round(total / perTool[tool]) : 0]));
    const top = Object.fromEntries(Object.entries(products).sort((a, b) => b[1] - a[1]).slice(0, 10));
    out.push({ day, users, calls, meanMs, products: top });
  }
  const week = list.slice(0, 7);
  const weekUsers = await store.pfcount(week.map((d) => `fr:u:${d}`));
  const dailySum = out.slice(0, 7).reduce((s, d) => s + d.users, 0);
  return { store: store.kind, days: out, week: { users: weekUsers, activeDaysPerUser: weekUsers ? Math.round((dailySum / weekUsers) * 100) / 100 : 0 } };
}

/** The stats token from `?stats=` matches MCP_STATS_TOKEN (constant time); never when the variable is unset. */
export function statsAllowed(given: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const want = env.MCP_STATS_TOKEN?.trim();
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
