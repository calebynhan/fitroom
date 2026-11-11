import { describe, expect, it } from 'vitest';
import { afterPass, afterQuota, allowanceText, current, FRESH, passesLeft, PASSES_PER_DAY, WINDOW_MS } from './allowance';

const T0 = Date.UTC(2026, 10, 11, 9, 0);

describe('allowance estimate', () => {
  it('counts passes within a day and starts over after it', () => {
    let a = afterPass(FRESH, T0);
    a = afterPass(a, T0 + 60_000);
    expect(passesLeft(a, T0 + 120_000)).toBe(PASSES_PER_DAY - 2);
    expect(current(a, T0 + WINDOW_MS)).toEqual(FRESH);
    expect(afterPass(a, T0 + WINDOW_MS + 1)).toMatchObject({ windowStart: T0 + WINDOW_MS + 1, passes: 1 });
  });

  it('a quota error means none left, until the day is over', () => {
    const a = afterQuota(afterPass(FRESH, T0), T0 + 1000);
    expect(passesLeft(a, T0 + 2000)).toBe(0);
    expect(a.startKnown).toBe(true);
    expect(passesLeft(a, T0 + WINDOW_MS)).toBe(PASSES_PER_DAY);
    // used up elsewhere (no pass of ours): the start is unknown
    expect(afterQuota(FRESH, T0)).toMatchObject({ exhausted: true, startKnown: false, windowStart: T0 });
  });

  it('says what a try-on costs and warns before it runs out', () => {
    expect(allowanceText(FRESH, 0, T0)?.text).toMatch(/no GPU time/);
    expect(allowanceText(FRESH, 2, T0)).toEqual({ text: `Uses 2 passes of about ${PASSES_PER_DAY} free a day.`, warn: false });
    const three = afterPass(afterPass(afterPass(FRESH, T0), T0), T0);
    expect(allowanceText(three, 1, T0)).toEqual({ text: 'Uses 1 pass; about 1 pass left today.', warn: false });
    expect(allowanceText(three, 2, T0)).toEqual({ text: 'This needs 2 passes and about 1 pass is left today, so it may stop partway.', warn: true });
    const four = afterPass(three, T0);
    expect(allowanceText(four, 2, T0)?.text).toBe(`You've probably used today's free GPU time (about ${PASSES_PER_DAY} passes), so this may not work.`);
    expect(allowanceText(afterQuota(three, T0), 2, T0)).toMatchObject({ warn: true, text: expect.stringMatching(/used up; it should be back around/) });
    expect(allowanceText(afterQuota(FRESH, T0), 2, T0)?.text).toMatch(/back within a day/);
  });
});
