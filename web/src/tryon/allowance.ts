// An estimate of the shopper's free GPU allowance, so FitRoom can warn before "used up" instead of only after.
// Hugging Face doesn't tell a browser how much is left: anonymous visitors get about 2 GPU-minutes a day per connection,
// a try-on pass takes ~26 s, so about 4 passes; the day restarts 24 h after the first use. Other people on the same
// network and other ZeroGPU Spaces draw on the same allowance, so this is only ever "about". Stored in localStorage
// (counts and times, nothing about the person).
import { create } from 'zustand';
import { safeStorage } from '../body/profile';

const KEY = 'fitroom.gpu.v1';
export const PASSES_PER_DAY = 4;
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface Allowance {
  /** When this allowance day started (our first pass), or null before any. */
  windowStart: number | null;
  /** True when windowStart is a real first use; false when it was only set by a quota error (start unknown). */
  startKnown: boolean;
  /** Passes FitRoom ran in this window. */
  passes: number;
  /** Hugging Face said the allowance is used up. */
  exhausted: boolean;
}

export const FRESH: Allowance = { windowStart: null, startKnown: false, passes: 0, exhausted: false };

/** The allowance as of `now`: a window older than a day is over. */
export function current(a: Allowance, now: number): Allowance {
  return a.windowStart !== null && now - a.windowStart >= WINDOW_MS ? FRESH : a;
}

export function afterPass(a: Allowance, now: number): Allowance {
  const c = current(a, now);
  return c.windowStart === null ? { ...c, windowStart: now, startKnown: true, passes: 1 } : { ...c, passes: c.passes + 1 };
}

export function afterQuota(a: Allowance, now: number): Allowance {
  const c = current(a, now);
  return { ...c, exhausted: true, windowStart: c.windowStart ?? now, startKnown: c.windowStart !== null && c.startKnown };
}

export function passesLeft(a: Allowance, now: number): number {
  const c = current(a, now);
  return c.exhausted ? 0 : Math.max(0, PASSES_PER_DAY - c.passes);
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** What to tell the shopper before a try-on that needs `need` passes (0 = already made). Null: nothing worth saying. */
export function allowanceText(a: Allowance, need: number, now: number): { text: string; warn: boolean } | null {
  const c = current(a, now);
  if (need === 0) return { text: 'Already made: this one costs no GPU time.', warn: false };
  if (c.exhausted) {
    const back = c.startKnown && c.windowStart !== null ? `around ${clock(c.windowStart + WINDOW_MS)}` : 'within a day';
    return { text: `Today's free GPU time looks used up; it should be back ${back}.`, warn: true };
  }
  const left = passesLeft(c, now);
  const passes = (n: number) => `${n} ${n === 1 ? 'pass' : 'passes'}`;
  if (left === 0) return { text: `You've probably used today's free GPU time (about ${passes(PASSES_PER_DAY)}), so this may not work.`, warn: true };
  if (left < need) {
    return { text: `This needs ${passes(need)} and about ${passes(left)} ${left === 1 ? 'is' : 'are'} left today, so it may stop partway.`, warn: true };
  }
  if (c.passes === 0) return { text: `Uses ${passes(need)} of about ${PASSES_PER_DAY} free a day.`, warn: false };
  return { text: `Uses ${passes(need)}; about ${passes(left)} left today.`, warn: false };
}

function load(): Allowance {
  try {
    const raw = JSON.parse(safeStorage()?.getItem(KEY) ?? 'null') as Partial<Allowance> | null;
    if (!raw || typeof raw.passes !== 'number') return FRESH;
    return {
      windowStart: typeof raw.windowStart === 'number' ? raw.windowStart : null,
      startKnown: raw.startKnown === true,
      passes: Math.max(0, Math.floor(raw.passes)),
      exhausted: raw.exhausted === true,
    };
  } catch {
    return FRESH;
  }
}

export const useAllowance = create<{ allowance: Allowance }>()(() => ({ allowance: load() }));

function update(next: Allowance): void {
  useAllowance.setState({ allowance: next });
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the estimate lasts until reload
  }
}

export const recordPass = (now = Date.now()) => update(afterPass(useAllowance.getState().allowance, now));
export const recordQuota = (now = Date.now()) => update(afterQuota(useAllowance.getState().allowance, now));
