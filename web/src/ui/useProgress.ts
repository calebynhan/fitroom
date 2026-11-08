import { useEffect, useState } from 'react';
import { EXPECTED_SHOT_MS, usePhoto } from '../state/photo';

const TICK_MS = 200;
const CAP = 0.95; // never claim 100% before the image arrives

/** Estimated progress (0..1) of the current photoreal shot, or null when idle. */
export function useProgress(): number | null {
  const photo = usePhoto((s) => s.photo);
  const [now, setNow] = useState(Date.now());
  const working = photo.kind === 'working';

  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [working]);

  if (photo.kind !== 'working') return null;
  const t = (now - photo.startedAt) / EXPECTED_SHOT_MS;
  return Math.min(CAP, 1 - Math.exp(-2.2 * t)); // fast start, eases toward the cap
}
