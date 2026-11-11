import { describe, expect, it } from 'vitest';
import { addReport, readReports, reportLine } from './fitReports';
import { memoryStore } from './store';

describe('fit reports', () => {
  it('tallies verdicts per size, names where it was off when one place stands out, and needs 5 to speak', async () => {
    const store = memoryStore();
    const add = (user: string, size: string, verdict: 'too_small' | 'just_right' | 'too_big', where: 'chest' | 'length' | null = null) =>
      addReport(store, user, 'E1', size, verdict, where);
    expect(await add('a', 'M', 'too_big', 'length')).toBe(true);
    expect(await add('a', 'S', 'just_right')).toBe(false); // one report per person per item
    await add('b', 'M', 'too_big', 'length');
    await add('c', 'M', 'just_right');
    await add('d', 'M', 'just_right');
    const four = await readReports(store, 'E1');
    expect(reportLine(four.M)).toBeNull();
    await add('e', 'M', 'too_small', 'chest');
    const r = (await readReports(store, 'E1')).M;
    expect(r).toEqual({ size: 'M', too_small: 1, just_right: 2, too_big: 2, total: 5, where: 'length' });
    expect(reportLine(r)).toBe('Shoppers who bought the M: 2 of 5 say it fits; 1 say it runs small; 2 say it runs big (length).');
  });

  it('writes inch sizes the way people say them', () => {
    expect(reportLine({ size: '30inch', too_small: 0, just_right: 5, too_big: 0, total: 5, where: null })).toBe('Shoppers who bought the 30": 5 of 5 say it fits.');
  });
});
