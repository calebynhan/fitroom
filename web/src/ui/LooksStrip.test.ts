import { describe, expect, it } from 'vitest';
import { colourFirst } from './LooksStrip';

describe('try-on strip labels', () => {
  it('puts the colour first, where names are cut off', () => {
    expect(colourFirst('Washable Milano Ribbed Sweater in Blue (67)')).toBe('Blue (67) Washable Milano Ribbed Sweater');
    expect(colourFirst('Ultra Stretch Pants in Dark Gray')).toBe('Dark Gray Ultra Stretch Pants');
    expect(colourFirst('No colour here')).toBe('No colour here');
  });
});
