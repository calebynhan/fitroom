import { useEffect, useState } from 'react';
import { EXPECTED_SHOT_MS, type Look, type ViewState } from '../state/looks';

const CAP = 0.95; // never claim 100% before the photo arrives

/** Estimated progress of one photo, 0..1 (fast start, easing toward the cap). */
export function viewProgress(state: ViewState, now: number): number {
  if (state.kind === 'done' || state.kind === 'error') return 1;
  if (state.kind === 'waiting') return 0;
  const t = (now - state.startedAt) / (state.expectedMs ?? EXPECTED_SHOT_MS);
  return Math.min(CAP, 1 - Math.exp(-2.2 * t));
}

/**
 * Estimated progress of a whole look. Four-view looks: the front first, then three angles at once. Other looks:
 * their views one after another. A size comparison running shows its own progress.
 */
export function lookProgress(look: Look, now: number): number {
  const comparing = Object.values(look.compares ?? {}).find((c) => c?.state.kind === 'working');
  if (comparing) return viewProgress(comparing.state, now);
  const each = look.order.map((v) => viewProgress(look.views[v], now));
  if (each.length === 0) return 0;
  if (look.order.length === 4 && look.order[0] === 'front') {
    const rest = each.slice(1);
    return 0.5 * each[0] + 0.5 * (rest.reduce((a, b) => a + b, 0) / rest.length);
  }
  return each.reduce((a, b) => a + b, 0) / each.length;
}

/** Current time, re-rendering every `ms` while `active`. */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
