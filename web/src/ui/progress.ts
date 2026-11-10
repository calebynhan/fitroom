import { useEffect, useState } from 'react';
import { VIEWS } from '@api/look';
import { EXPECTED_SHOT_MS, type Look, type ViewState } from '../state/looks';

const CAP = 0.95; // never claim 100% before the photo arrives

/** Estimated progress of one photo, 0..1 (fast start, easing toward the cap). */
export function viewProgress(state: ViewState, now: number): number {
  if (state.kind === 'done' || state.kind === 'error') return 1;
  if (state.kind === 'waiting') return 0;
  const t = (now - state.startedAt) / EXPECTED_SHOT_MS;
  return Math.min(CAP, 1 - Math.exp(-2.2 * t));
}

/** Estimated progress of a whole look: front first, then three angles at once (or the size comparison running). */
export function lookProgress(look: Look, now: number): number {
  const comparing = Object.values(look.compares ?? {}).find((c) => c?.state.kind === 'working');
  if (comparing) return viewProgress(comparing.state, now);
  const front = viewProgress(look.views.front, now);
  const rest = VIEWS.filter((v) => v !== 'front').map((v) => viewProgress(look.views[v], now));
  return 0.5 * front + 0.5 * (rest.reduce((a, b) => a + b, 0) / rest.length);
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
