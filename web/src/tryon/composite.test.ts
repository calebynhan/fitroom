import { describe, expect, it } from 'vitest';
import { changedPerRow, garmentTop, sameFraming } from './composite';

function image(w: number, h: number, paint?: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) px.set([...(paint?.(x, y) ?? [120, 120, 120]), 255], (y * w + x) * 4);
  return px;
}

describe('sharpening the try-on result', () => {
  const w = 100;
  const h = 200;
  const before = image(w, h);

  it('finds where the new garment starts (the collar)', () => {
    const after = image(w, h, (x, y) => (y >= 70 && y < 150 && x > 30 && x < 70 ? [20, 60, 90] : [120, 120, 120]));
    const rows = changedPerRow(before, after, w, h);
    expect(rows[50]).toBe(0);
    expect(rows[100]).toBeGreaterThan(30);
    expect(garmentTop(rows, w)).toBeCloseTo(0.35, 1);
  });

  it('ignores specks, and gives up when nothing changed or the garment starts at the very top', () => {
    const specks = image(w, h, (x, y) => (y === 20 && x === 50 ? [0, 0, 0] : [120, 120, 120]));
    expect(garmentTop(changedPerRow(before, specks, w, h), w)).toBeNull();
    expect(garmentTop(changedPerRow(before, before, w, h), w)).toBeNull();
    const fromTop = image(w, h, (x) => (x > 30 && x < 70 ? [20, 60, 90] : [120, 120, 120]));
    expect(garmentTop(changedPerRow(before, fromTop, w, h), w)).toBeNull();
  });

  it('only lines up images with the same framing', () => {
    expect(sameFraming({ width: 486, height: 864 }, { width: 1125, height: 2000 })).toBe(true);
    expect(sameFraming({ width: 576, height: 864 }, { width: 1125, height: 2000 })).toBe(false);
  });
});
