import { describe, expect, it } from 'vitest';
import { fitFor, parseFits } from './fits';

const FITS = parseFits({
  items: {
    'E422992-000': { shape: 'tee', morphs: { fit_boxy: 1 }, fit: 'Boxy heavyweight (Uniqlo U)' },
    'E455365-000': { shape: 'tee', morphs: {}, fit: 'Regular (SUPIMA)' },
    broken: { morphs: { fit_boxy: 'x' } },
  },
  name_rules: [
    { match: 'barrel|wide', morphs: { fit_barrel: 1 } },
    { match: '([bad', morphs: { fit_tight: 1 } },
  ],
});

describe('fits', () => {
  it('drops malformed entries', () => {
    expect(FITS && Object.keys(FITS.items)).toEqual(['E422992-000', 'E455365-000']);
    expect(parseFits(null)).toBeNull();
  });
  it('prefers the exact item entry', () => {
    expect(fitFor(FITS, 'E422992-000', 'Crew Neck T-Shirt')).toEqual({ morphs: { fit_boxy: 1 }, label: 'Boxy heavyweight (Uniqlo U)' });
    expect(fitFor(FITS, 'E455365-000', 'SUPIMA Cotton T-Shirt').morphs).toEqual({});
  });
  it('falls back to name rules for pasted items and survives bad regexes', () => {
    expect(fitFor(FITS, 'E999999-000', 'Wide Straight Jeans').morphs).toEqual({ fit_barrel: 1 });
    expect(fitFor(FITS, 'E999999-000', 'Oxford Shirt')).toEqual({ morphs: {}, label: null });
  });
  it('is a no-op without fits.json', () => {
    expect(fitFor(null, 'E422992-000', 'x')).toEqual({ morphs: {}, label: null });
  });
});
