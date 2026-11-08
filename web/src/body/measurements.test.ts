import { describe, expect, it } from 'vitest';
import { parseCatalog, formatSizes } from '../catalog/types';
import { girthsForWeights, parseBodyMeasure, setWeight, weightsForGirths, type BodyMeasure } from './measurements';

// Values from Session A's body_measure.json.
const MEASURE: BodyMeasure = {
  default_weights: [-1.5689, -1.1916, 0.689, 0.2779, 0.156, -0.2611],
  measured_cm_at_default: { chest: 92.0, waist: 75.0, hips: 90.01 },
  jacobian_cm_per_unit: {
    chest: [13.9594, -1.8044, 1.8245, -1.532, -0.0881, 0.5784],
    waist: [17.417, -2.9647, 2.1463, 0.0668, 0.8483, -0.3764],
    hips: [7.5407, 4.3443, -2.7692, -0.1582, -0.1363, 0.4944],
  },
};

describe('weightsForGirths', () => {
  it('returns the defaults for the default measurements', () => {
    const w = weightsForGirths(MEASURE, MEASURE.measured_cm_at_default);
    w.forEach((v, i) => expect(v).toBeCloseTo(MEASURE.default_weights[i], 6));
  });

  it('round-trips through the linear model', () => {
    const target = { chest: 98, waist: 80, hips: 94 };
    const est = girthsForWeights(MEASURE, weightsForGirths(MEASURE, target));
    expect(est.chest).toBeCloseTo(98, 3);
    expect(est.waist).toBeCloseTo(80, 3);
    expect(est.hips).toBeCloseTo(94, 3);
  });

  it('clamps extreme targets to -3..3', () => {
    weightsForGirths(MEASURE, { chest: 150, waist: 150, hips: 60 }).forEach((v) => expect(Math.abs(v)).toBeLessThanOrEqual(3));
  });
});

describe('helpers', () => {
  it('setWeight returns a new clamped array', () => {
    const before = [0, 0];
    const after = setWeight(before, 1, 9);
    expect(after).toEqual([0, 3]);
    expect(before).toEqual([0, 0]);
  });

  it('parseBodyMeasure rejects malformed files', () => {
    expect(parseBodyMeasure(MEASURE)).not.toBeNull();
    expect(parseBodyMeasure({ default_weights: [0] })).toBeNull();
    expect(parseBodyMeasure(null)).toBeNull();
  });

  it('parseCatalog accepts wrapped or bare lists and drops bad items', () => {
    const good = { id: 'E1', name: 'Tee', slot: 'top', shape: 'tee', colors: [{ code: '00', name: 'White', hex: '#fff', swatch: '' }] };
    expect(parseCatalog({ items: [good, { id: 'bad' }] })).toHaveLength(1);
    expect(parseCatalog([good])).toHaveLength(1);
    expect(parseCatalog('nope')).toEqual([]);
  });

  it('formatSizes handles ranges and arrays', () => {
    expect(formatSizes('XXS-3XL')).toBe('XXS-3XL');
    expect(formatSizes(['S', 'M', 'L', 'XL'])).toBe('S-XL');
    expect(formatSizes(['28', '30'])).toBe('28, 30');
  });
});
