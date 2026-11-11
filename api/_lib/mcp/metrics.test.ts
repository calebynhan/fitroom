import { describe, expect, it } from 'vitest';
import { readStats, recordCall, statsAllowed } from './metrics';
import { memoryStore, type Store } from './store';

describe('usage metrics', () => {
  it('adds up calls, mean times and distinct users across days', async () => {
    const day = Date.UTC(2026, 10, 11, 12);
    const store = memoryStore(() => day);
    await recordCall(store, 'u:a', { tool: 'recommend_size', outcome: 'ok', ms: 100, product: 'E1' }, day, false);
    await recordCall(store, 'u:a', { tool: 'recommend_size', outcome: 'ok', ms: 300, product: 'E1' }, day, false);
    await recordCall(store, 'u:b', { tool: 'find_clothes', outcome: 'ok', ms: 50 }, day, false);
    await recordCall(store, 'u:a', { tool: 'recommend_size', outcome: 'ok', ms: 200 }, day - 24 * 3600 * 1000, false);
    const stats = await readStats(store, 3, day);
    expect(stats.days.map((d) => d.day)).toEqual(['2026-11-11', '2026-11-10', '2026-11-09']);
    expect(stats.days[0]).toMatchObject({ users: 2, calls: { 'recommend_size:ok': 2, 'find_clothes:ok': 1 }, meanMs: { recommend_size: 200, find_clothes: 50 } });
    expect(stats.days[0].products).toEqual({ 'recommend_size:E1': 2 });
    expect(stats.days[1].users).toBe(1);
    expect(stats.week).toEqual({ users: 2, activeDaysPerUser: 1.5 });
  });

  it('never lets a slow or broken store hold up the answer', async () => {
    const broken: Store = { ...memoryStore(), hincr: async () => { throw new Error('down'); } };
    await expect(recordCall(broken, 'u:a', { tool: 't', outcome: 'ok', ms: 1 }, Date.now(), false)).resolves.toBeUndefined();
    const slow: Store = { ...memoryStore(), pfadd: () => new Promise(() => {}) };
    const started = Date.now();
    await recordCall(slow, 'u:a', { tool: 't', outcome: 'ok', ms: 1 }, Date.now(), false);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('opens the stats only to the exact owner token', () => {
    expect(statsAllowed('x', {})).toBe(false);
    expect(statsAllowed(null, { MCP_STATS_TOKEN: 'abc' })).toBe(false);
    expect(statsAllowed('abd', { MCP_STATS_TOKEN: 'abc' })).toBe(false);
    expect(statsAllowed('abc', { MCP_STATS_TOKEN: 'abc' })).toBe(true);
  });
});
