import { describe, expect, it } from 'vitest';
import {
  completeBody,
  EMPTY_PROFILE,
  displayRange,
  estimate,
  fitPrefs,
  fromFeetInches as feetToCm,
  heightRangeFeet,
  inRange,
  LIMITS,
  type MeasureKey,
  fromDisplay,
  fromFeetInches,
  loadProfile,
  parseProfile,
  saveProfile,
  toDisplay,
  toFeetInches,
} from './profile';

describe('ANSUR estimates', () => {
  it('lands near the default body for 178 cm / 65 kg', () => {
    const e = estimate(178, 65);
    expect(e.chestCm).toBeCloseTo(92.4, 0);
    expect(e.waistCm).toBeCloseTo(76.7, 0);
    expect(e.hipsCm).toBeCloseTo(90.6, 0);
    expect(e.inseamCm).toBeCloseTo(86.9, 0);
  });
});

describe('completeBody', () => {
  it('needs height and weight', () => {
    expect(completeBody(EMPTY_PROFILE)).toBeNull();
    expect(completeBody({ ...EMPTY_PROFILE, heightCm: 178 })).toBeNull();
    expect(completeBody({ ...EMPTY_PROFILE, heightCm: 90, weightKg: 65 })).toBeNull();
  });

  it('keeps entered measurements and estimates the blanks', () => {
    const body = completeBody({ ...EMPTY_PROFILE, heightCm: 178, weightKg: 65, waistCm: 74 });
    expect(body).toMatchObject({ heightCm: 178, weightKg: 65, waistCm: 74 });
    expect(body!.chestCm).toBeCloseTo(92.4, 0);
  });
});

describe('units', () => {
  it('converts both ways without drifting on a round trip', () => {
    expect(toDisplay('heightCm', 178, 'metric')).toBe(178);
    expect(toDisplay('weightKg', 65, 'imperial')).toBe(143);
    expect(fromDisplay('weightKg', 143, 'imperial')).toBeCloseTo(64.9, 1);
    expect(toDisplay('chestCm', 92, 'imperial')).toBe(36); // 36.2 in, halves
    expect(fromDisplay('chestCm', 36, 'imperial')).toBeCloseTo(91.4, 1);
    expect(toFeetInches(178)).toEqual({ ft: 5, in: 10 });
    expect(toFeetInches(fromFeetInches(5, 10))).toEqual({ ft: 5, in: 10 });
    expect(toFeetInches(182.88)).toEqual({ ft: 6, in: 0 });
  });
});

describe('storage', () => {
  it('round-trips and ignores junk', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveProfile({ ...EMPTY_PROFILE, units: 'metric', heightCm: 178, weightKg: 65 }, storage);
    expect(loadProfile(storage)).toMatchObject({ units: 'metric', heightCm: 178, weightKg: 65, chestCm: null });
    expect(parseProfile({ heightCm: 'tall', weightKg: 9999, units: 'cubits' })).toEqual(EMPTY_PROFILE);
    store.set('fitroom.profile.v1', '{not json');
    expect(loadProfile(storage)).toEqual(EMPTY_PROFILE);
  });
});

describe('fit preferences', () => {
  it('reads a preference per slot and the flat garment measurements as full circumferences', () => {
    const p = parseProfile({ fitTop: 'relaxed', fitBottom: 'baggy', refTopChestFlatCm: 53, refTopLengthCm: 69, refBottomHipsFlatCm: 200 });
    expect(p).toMatchObject({ fitTop: 'relaxed', fitBottom: 'regular', refTopChestFlatCm: 53, refBottomHipsFlatCm: null });
    expect(fitPrefs(p)).toEqual({ top: { pref: 'relaxed', chestCm: 106, lengthCm: 69 }, bottom: { pref: 'regular' } });
    expect(fitPrefs(EMPTY_PROFILE)).toEqual({ top: { pref: 'regular' }, bottom: { pref: 'regular' } });
  });
});

describe('range hints', () => {
  it('only offer values that are then accepted, in both unit systems', () => {
    for (const key of Object.keys(LIMITS) as MeasureKey[]) {
      for (const units of ['metric', 'imperial'] as const) {
        if (key === 'heightCm' && units === 'imperial') continue;
        const [lo, hi] = displayRange(key, units);
        expect(inRange(key, fromDisplay(key, lo, units)), `${key} ${units} min ${lo}`).toBe(true);
        expect(inRange(key, fromDisplay(key, hi, units)), `${key} ${units} max ${hi}`).toBe(true);
      }
    }
    expect(displayRange('refTopChestFlatCm', 'imperial')).toEqual([14, 35]); // was shown as 14-35.5, and 35.5 in was refused
    const [lo, hi] = heightRangeFeet();
    expect(inRange('heightCm', feetToCm(lo.ft, lo.in))).toBe(true);
    expect(inRange('heightCm', feetToCm(hi.ft, hi.in))).toBe(true);
  });
});
