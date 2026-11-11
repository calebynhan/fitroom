// "Did it fit?": shoppers tell ChatGPT how a UNIQLO item they bought fits, and FitRoom keeps only anonymous tallies per
// product, size and verdict (plus where it was off). No measurements are kept; one report per person per product
// (hashed ChatGPT id, 180 days). recommend_size shows the tallies once a size has MIN_REPORTS of them, so the advice
// learns from what people actually kept. Keys: fr:fit:<productId> (hash "<size>|<verdict>[|<where>]"), fr:fitby:<productId>:<user>.
import type { Store } from './store';

export const VERDICTS = ['too_small', 'just_right', 'too_big'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const WHERE = ['overall', 'chest', 'shoulders', 'waist', 'hips', 'thighs', 'length', 'sleeves', 'inseam'] as const;
export type Where = (typeof WHERE)[number];
export const MIN_REPORTS = 5;
const TTL_S = 2 * 365 * 24 * 3600;
const ONE_PER_PERSON_S = 180 * 24 * 3600;

export interface SizeReports {
  size: string;
  too_small: number;
  just_right: number;
  too_big: number;
  total: number;
  /** The most named place it was off, when one stands out ("chest"). */
  where: Where | null;
}

/** Records one report; false when this person already reported this product. */
export async function addReport(store: Store, user: string, productId: string, size: string, verdict: Verdict, where: Where | null): Promise<boolean> {
  const seen = await store.incr(`fr:fitby:${productId}:${user}`, 1, ONE_PER_PERSON_S);
  if (seen > 1) return false;
  await store.hincr(`fr:fit:${productId}`, `${size}|${verdict}`, 1, TTL_S);
  if (where && where !== 'overall' && verdict !== 'just_right') await store.hincr(`fr:fit:${productId}`, `${size}|${verdict}|${where}`, 1, TTL_S);
  return true;
}

/** Tallies per size for a product. */
export async function readReports(store: Store, productId: string): Promise<Record<string, SizeReports>> {
  const raw = await store.hgetall(`fr:fit:${productId}`);
  const out: Record<string, SizeReports> = {};
  const wheres: Record<string, Record<string, number>> = {};
  for (const [field, n] of Object.entries(raw)) {
    const [size, verdict, where] = field.split('|');
    if (!size || !(VERDICTS as readonly string[]).includes(verdict)) continue;
    out[size] ??= { size, too_small: 0, just_right: 0, too_big: 0, total: 0, where: null };
    if (where) (wheres[size] ??= {})[where] = (wheres[size][where] ?? 0) + n;
    else {
      out[size][verdict as Verdict] += n;
      out[size].total += n;
    }
  }
  for (const [size, counts] of Object.entries(wheres)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const off = out[size] ? out[size].too_small + out[size].too_big : 0;
    if (out[size] && top && top[1] * 2 >= off) out[size].where = top[0] as Where;
  }
  return out;
}

const label = (size: string) => size.replace(/^(\d+)\s*inch$/i, '$1"');

/** "Shoppers who kept the S: 5 of 7 say it fits; 2 say it runs small (chest)." or null below MIN_REPORTS. */
export function reportLine(r: SizeReports | undefined): string | null {
  if (!r || r.total < MIN_REPORTS) return null;
  const parts = [`${r.just_right} of ${r.total} say it fits`];
  if (r.too_small) parts.push(`${r.too_small} say it runs small`);
  if (r.too_big) parts.push(`${r.too_big} say it runs big`);
  const where = r.where && (r.too_small || r.too_big) ? ` (${r.where})` : '';
  return `Shoppers who bought the ${label(r.size)}: ${parts.join('; ')}${where}.`;
}
