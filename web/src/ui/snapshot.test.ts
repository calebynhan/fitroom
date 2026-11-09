import { describe, expect, it } from 'vitest';
import { MAX_SIDE, portraitCrop } from './snapshot';

describe('portraitCrop', () => {
  it('crops the centre 2:3 of a wide canvas and caps the long side at 1024px', () => {
    const c = portraitCrop(2400, 1600); // retina desktop
    expect(c.sh).toBe(1600);
    expect(c.sw).toBe(Math.round((1600 * 2) / 3));
    expect(c.sx).toBe(Math.round((2400 - c.sw) / 2));
    expect(c.outH).toBe(MAX_SIDE);
    expect(c.outW).toBe(Math.round(c.sw * (MAX_SIDE / 1600)));
    expect(Math.max(c.outW, c.outH)).toBeLessThanOrEqual(1024);
  });

  it('uses the full width of a tall (mobile) canvas', () => {
    const c = portraitCrop(780, 1400);
    expect(c.sw).toBe(780);
    expect(c.sx).toBe(0);
    expect(Math.max(c.outW, c.outH)).toBeLessThanOrEqual(1024);
  });

  it('never upscales a small canvas', () => {
    const c = portraitCrop(600, 600);
    expect(c.outH).toBe(600);
    expect(c.outW).toBe(400);
  });

  it('rejects an empty canvas', () => {
    expect(() => portraitCrop(0, 0)).toThrow();
  });
});
