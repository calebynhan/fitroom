// The shopper's measurements. Height and weight are required; chest, waist, hips and inseam are optional and
// estimated from height + weight when blank. Stored in metric; shown in either unit system.
import type { BodySpec } from '@api/look';

export type Units = 'metric' | 'imperial';
export const OPTIONAL = ['chestCm', 'waistCm', 'hipsCm', 'inseamCm'] as const;
export type OptionalKey = (typeof OPTIONAL)[number];
export type MeasureKey = 'heightCm' | 'weightKg' | OptionalKey;

export interface Profile {
  units: Units;
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  inseamCm: number | null;
}

export const EMPTY_PROFILE: Profile = { units: 'imperial', heightCm: null, weightKg: null, chestCm: null, waistCm: null, hipsCm: null, inseamCm: null };

/** Accepted ranges (metric). Inside the server's own limits in api/_lib/look.ts. */
export const LIMITS: Record<MeasureKey, [number, number]> = {
  heightCm: [140, 215],
  weightKg: [40, 180],
  chestCm: [70, 150],
  waistCm: [55, 150],
  hipsCm: [70, 150],
  inseamCm: [60, 100],
};

// ANSUR II (2012) men, linear regression on height + weight; copied from web/public/models/fit_model.json `estimate`
// (pipeline/fit_model.py). Residual SD: chest 3.2 cm, waist 4.4, hips 2.6, inseam 2.3.
const ESTIMATE: Record<OptionalKey, { intercept: number; heightCm: number; weightKg: number }> = {
  chestCm: { intercept: 103.6434, heightCm: -0.29094, weightKg: 0.62349 },
  waistCm: { intercept: 102.4906, heightCm: -0.43577, weightKg: 0.79624 },
  hipsCm: { intercept: 80.8411, heightCm: -0.14014, weightKg: 0.53462 },
  inseamCm: { intercept: -20.9573, heightCm: 0.61999, weightKg: -0.03898 },
};

const clamp = (v: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function inRange(key: MeasureKey, value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= LIMITS[key][0] && value <= LIMITS[key][1];
}

/** Estimated chest / waist / hips / inseam for this height and weight. */
export function estimate(heightCm: number, weightKg: number): Record<OptionalKey, number> {
  const out = {} as Record<OptionalKey, number>;
  for (const key of OPTIONAL) {
    const e = ESTIMATE[key];
    out[key] = round1(clamp(e.intercept + heightCm * e.heightCm + weightKg * e.weightKg, LIMITS[key]));
  }
  return out;
}

/** Full body for the photo request (entered values, estimates for the blanks), or null without height + weight. */
export function completeBody(p: Profile): BodySpec | null {
  if (!inRange('heightCm', p.heightCm) || !inRange('weightKg', p.weightKg)) return null;
  const est = estimate(p.heightCm, p.weightKg);
  const pick = (k: OptionalKey) => (inRange(k, p[k]) ? round1(p[k]) : est[k]);
  return {
    heightCm: round1(p.heightCm),
    weightKg: round1(p.weightKg),
    chestCm: pick('chestCm'),
    waistCm: pick('waistCm'),
    hipsCm: pick('hipsCm'),
    inseamCm: pick('inseamCm'),
  };
}

// Unit conversion. Values are stored in cm / kg; imperial fields convert on the way in and out.
export const CM_PER_IN = 2.54;
export const KG_PER_LB = 0.45359237;

export function toDisplay(key: MeasureKey, metric: number, units: Units): number {
  if (units === 'metric') return Math.round(metric);
  return key === 'weightKg' ? Math.round(metric / KG_PER_LB) : Math.round((metric / CM_PER_IN) * 2) / 2;
}

export function fromDisplay(key: MeasureKey, shown: number, units: Units): number {
  if (units === 'metric') return shown;
  return round1(key === 'weightKg' ? shown * KG_PER_LB : shown * CM_PER_IN);
}

export function unitLabel(key: MeasureKey, units: Units): string {
  if (key === 'weightKg') return units === 'metric' ? 'kg' : 'lb';
  return units === 'metric' ? 'cm' : 'in';
}

/** 178 -> { ft: 5, in: 10 } */
export function toFeetInches(cm: number): { ft: number; in: number } {
  const total = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(total / 12), in: total % 12 };
}

export function fromFeetInches(ft: number, inches: number): number {
  return round1((ft * 12 + inches) * CM_PER_IN);
}

const STORAGE_KEY = 'fitroom.profile.v1';

export function parseProfile(data: unknown): Profile {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const num = (k: MeasureKey) => (typeof d[k] === 'number' && inRange(k, d[k] as number) ? (d[k] as number) : null);
  return {
    units: d.units === 'metric' ? 'metric' : 'imperial',
    heightCm: num('heightCm'),
    weightKg: num('weightKg'),
    chestCm: num('chestCm'),
    waistCm: num('waistCm'),
    hipsCm: num('hipsCm'),
    inseamCm: num('inseamCm'),
  };
}

export function loadProfile(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Profile {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? parseProfile(JSON.parse(raw)) : { ...EMPTY_PROFILE };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(p: Profile, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // private mode / quota: measurements just won't persist
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
