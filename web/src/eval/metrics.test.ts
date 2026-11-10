import { describe, expect, it } from 'vitest';
import { flags, lab, scoreTryOn } from './metrics';

const W = 40;
const H = 80;
const img = (paint: (x: number, y: number) => [number, number, number]) => {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) px.set([...paint(x, y), 255], (y * W + x) * 4);
  return px;
};
const wall = (): [number, number, number] => [150, 150, 150];
const navy: [number, number, number] = [30, 60, 110];
const product = { px: img(() => navy), width: W, height: H, fabric: [0.3, 0.3, 0.7, 0.7] as [number, number, number, number] };

describe('try-on metrics', () => {
  it('converts sRGB to Lab', () => {
    expect(lab(255, 255, 255)[0]).toBeCloseTo(100, 0);
    expect(lab(0, 0, 0)[0]).toBeCloseTo(0, 0);
  });

  it('scores a clean try-on: face untouched, garment in the product colour', () => {
    const before = img(wall);
    const after = img((x, y) => (y >= 30 && y < 60 && x > 10 && x < 30 ? navy : wall()));
    const s = scoreTryOn(before, after, W, H, product);
    expect(s.changed).toBeCloseTo((30 * 19) / (W * H), 2);
    expect(s.aboveGarment).toBe(0);
    expect(s.colourDE).toBeCloseTo(0, 1);
    expect(flags(s)).toEqual([]);
  });

  it('flags a garment that barely changed, a redrawn scene and a changed face', () => {
    const before = img(wall);
    expect(flags(scoreTryOn(before, img(wall), W, H, product))).toEqual(['garment barely changed (similar colour to what they wore?)']);
    const redrawn = scoreTryOn(before, img(() => navy), W, H, product);
    expect(flags(redrawn)).toContain('large area redrawn (blur, background or pose changed)');
    const face = img((x, y) => (y < 20 ? [170, 170, 170] : y >= 30 && y < 60 && x > 10 && x < 30 ? navy : wall()));
    expect(flags(scoreTryOn(before, face, W, H, product))).toEqual(['face or background changed']);
  });
});
