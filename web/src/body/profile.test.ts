import { describe, expect, it } from 'vitest';
import {
  completeBody,
  EMPTY_PROFILE,
  estimate,
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
