import { describe, expect, it } from 'vitest';
import { lookKey, type LookInput } from './lookKey';

const BASE: LookInput = {
  model: 'male',
  outfit: { top: { itemId: 'E453754-000', colorCode: '67' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
  scene: 'studio',
  pose: 'pocket',
  heightCm: 178,
  girths: { chest: 92, waist: 75, hips: 90 },
};

describe('lookKey', () => {
  it('is stable for the same look', () => {
    expect(lookKey(BASE)).toBe(lookKey({ ...BASE, girths: { ...BASE.girths } }));
  });

  it.each<[string, Partial<LookInput>]>([
    ['colour', { outfit: { ...BASE.outfit, top: { itemId: 'E453754-000', colorCode: '09' } } }],
    ['item', { outfit: { ...BASE.outfit, bottom: { itemId: 'E479000-000', colorCode: '09' } } }],
    ['scene', { scene: 'city' }],
    ['pose', { pose: 'walk' }],
    ['height', { heightCm: 180 }],
    ['girth', { girths: { ...BASE.girths, waist: 80 } }],
    ['model', { model: 'female' }],
  ])('changes when the %s changes', (_label, patch) => {
    expect(lookKey({ ...BASE, ...patch })).not.toBe(lookKey(BASE));
  });

  it('handles an empty slot', () => {
    expect(lookKey({ ...BASE, outfit: { top: null, bottom: null } })).toContain('-');
  });
});
