import { describe, expect, it } from 'vitest';
import { garmentOnlyUrl, isModelShot, topCentreCoverage } from './garment';

describe('garment-only photos', () => {
  it("derives UNIQLO's garment-only shot from the catalogue photo", () => {
    expect(garmentOnlyUrl('/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg')).toBe(
      '/uniqlo/UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg',
    );
    expect(garmentOnlyUrl('/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.png')).toBeNull();
    expect(garmentOnlyUrl('https://example.com/x.jpg')).toBeNull();
  });

  it('tells a garment on its own from one worn by a model (a head at the top centre)', () => {
    const w = 60;
    const h = 80;
    const backdrop = () => {
      const px = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i += 1) px.set([235, 237, 240, 255], i * 4);
      return px;
    };
    const flat = backdrop();
    for (let y = 20; y < 70; y += 1) for (let x = 10; x < 50; x += 1) flat.set([40, 90, 120, 255], (y * w + x) * 4); // a sweater, lower down
    expect(topCentreCoverage(flat, w, h)).toBe(0);
    const worn = backdrop();
    for (let y = 0; y < 6; y += 1) for (let x = 24; x < 36; x += 1) worn.set([30, 25, 20, 255], (y * w + x) * 4); // hair
    for (let y = 6; y < 16; y += 1) for (let x = 25; x < 35; x += 1) worn.set([205, 160, 135, 255], (y * w + x) * 4); // a face
    expect(topCentreCoverage(worn, w, h)).toBeGreaterThan(0.05);
    expect(isModelShot(worn, w, h)).toBe(true);
    expect(isModelShot(flat, w, h)).toBe(false);
  });

  it('does not mistake tall pants laid out alone for a model (the waistband reaches the top band)', () => {
    const w = 60;
    const h = 80;
    const pants = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) pants.set([235, 237, 240, 255], i * 4);
    for (let y = 8; y < 76; y += 1) for (let x = 15; x < 45; x += 1) pants.set([45, 45, 48, 255], (y * w + x) * 4); // black wide pants
    expect(topCentreCoverage(pants, w, h)).toBeGreaterThan(0.05); // what fooled the old rule
    expect(isModelShot(pants, w, h)).toBe(false);
    const khaki = new Uint8ClampedArray(pants);
    for (let y = 8; y < 76; y += 1) for (let x = 15; x < 45; x += 1) khaki.set([150, 135, 105, 255], (y * w + x) * 4); // khaki: r-g < 15
    expect(isModelShot(khaki, w, h)).toBe(false);
  });
});
