// Vercel Web Analytics: anonymous page views, no cookies. Plus one custom event, the outcome of each try-on photo, so
// failure rates (quota, busy, timeouts) are known (quality audit Phase 4). Never photos, names, measurements or URLs
// with an outfit in them. Custom events need a Vercel Pro plan; on Hobby they are dropped and only page views count.
import { inject, track } from '@vercel/analytics';
import { SpaceError } from './tryon/space';

export function startAnalytics(): void {
  if (!import.meta.env.PROD) return;
  inject({
    framework: 'vite',
    // count the page, not the query (a shared outfit) or the hash
    beforeSend: (event) => ({ ...event, url: event.url.replace(/[?#].*$/, '') }),
  });
}

export type TryOnOutcome = 'ok' | 'partial' | 'quota' | 'busy' | 'timeout' | 'unreachable' | 'cancelled' | 'photo' | 'error';

/** The outcome bucket of a try-on failure (by the shopper-facing messages in tryon/space.ts and tryon/shoot.ts). */
export function outcomeOf(err: SpaceError): TryOnOutcome {
  if (err.quota) return 'quota';
  if (err.cancelled) return 'cancelled';
  if (/taking too long/i.test(err.message)) return 'timeout';
  if (/busy right now/i.test(err.message)) return 'busy';
  if (/waking up or unreachable|check your connection|product photo/i.test(err.message)) return 'unreachable';
  if (/couldn't read your photo|didn't work for this photo/i.test(err.message)) return 'photo';
  return 'error';
}

/** One event per photo attempted: `outcome`, why a partial one stopped, which view, garments, seconds taken. */
export function trackTryOn(outcome: TryOnOutcome, view: string, garments: number, startedAt: number, reason?: TryOnOutcome): void {
  if (!import.meta.env.PROD) return;
  try {
    track('tryon', { outcome, reason, view, garments, seconds: Math.round((Date.now() - startedAt) / 1000) });
  } catch {
    // analytics must never break a try-on
  }
}
