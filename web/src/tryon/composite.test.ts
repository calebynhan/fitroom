import { describe, expect, it } from 'vitest';
import { changedMask, changedPerRow, garmentRegion, garmentTop, isSkin, regionAlpha, sameFraming, sameSkin, skinColouredHex, unsharp } from './composite';

function image(w: number, h: number, paint?: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) px.set([...(paint?.(x, y) ?? [120, 120, 120]), 255], (y * w + x) * 4);
  return px;
}

const w = 100;
const h = 200;
const before = image(w, h);
// a new top: rows 70-149, columns 31-69
const top = image(w, h, (x, y) => (y >= 70 && y < 150 && x > 30 && x < 70 ? [20, 60, 90] : [120, 120, 120]));

describe('finding what the try-on changed', () => {
  it('finds where the new garment starts (the collar)', () => {
    const rows = changedPerRow(before, top, w, h);
    expect(rows[50]).toBe(0);
    expect(rows[100]).toBeGreaterThan(30);
    expect(garmentTop(rows, w)).toBeCloseTo(0.35, 1);
  });

  it('ignores specks and finds nothing when nothing changed', () => {
    const specks = image(w, h, (x, y) => (y === 20 && x === 50 ? [0, 0, 0] : [120, 120, 120]));
    expect(garmentTop(changedPerRow(before, specks, w, h), w)).toBeNull();
    expect(garmentRegion(changedMask(before, specks, w, h), w, h)).toBeNull();
    expect(garmentRegion(changedMask(before, before, w, h), w, h)).toBeNull();
  });

  it('a slight change (light, compression) is not a garment', () => {
    const lighter = image(w, h, () => [132, 132, 132]);
    expect(garmentRegion(changedMask(before, lighter, w, h), w, h)).toBeNull();
  });
});

describe('the region taken from the model', () => {
  it('spans the garment row by row, with a margin, and nothing above or below it', () => {
    const region = garmentRegion(changedMask(before, top, w, h), w, h)!;
    expect(region.top).toBeGreaterThanOrEqual(68);
    expect(region.top).toBeLessThanOrEqual(71);
    expect(region.bottom).toBeGreaterThanOrEqual(147);
    expect(region.bottom).toBeLessThanOrEqual(151);
    const [left, right] = region.spans[110]!;
    expect(left).toBeLessThan(31);
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(69);
    expect(right).toBeLessThan(80);
    expect(region.spans[30]).toBeNull();
  });

  it('fills rows inside the garment where little changed, so the old garment never shows through', () => {
    // a band across the middle of the new top barely differs from what was there (dark over dark)
    const patchy = image(w, h, (x, y) => (y >= 70 && y < 150 && x > 30 && x < 70 && (y < 100 || y >= 104) ? [20, 60, 90] : [120, 120, 120]));
    const region = garmentRegion(changedMask(before, patchy, w, h), w, h)!;
    for (let y = 100; y < 104; y += 1) expect(region.spans[y]![1] - region.spans[y]![0]).toBeGreaterThan(38);
  });

  it('uses the model fully inside the region and the photo well outside it, with a soft edge', () => {
    const region = garmentRegion(changedMask(before, top, w, h), w, h)!;
    const alpha = regionAlpha(region, w, h);
    expect(alpha[110 * w + 50]).toBeCloseTo(1, 2);
    expect(alpha[30 * w + 50]).toBe(0);
    expect(alpha[110 * w + 2]).toBe(0);
    expect(alpha[190 * w + 50]).toBe(0);
    const edge = alpha[110 * w + region.spans[110]![1]];
    expect(edge).toBeGreaterThan(0.2);
    expect(edge).toBeLessThan(0.8);
  });

  it('only lines up images with the same framing', () => {
    expect(sameFraming({ width: 486, height: 864 }, { width: 1125, height: 2000 })).toBe(true);
    expect(sameFraming({ width: 576, height: 864 }, { width: 1125, height: 2000 })).toBe(false);
  });
});

describe('sharpening the enlarged model output', () => {
  it('leaves flat areas alone and steepens edges', () => {
    const flat = image(20, 20);
    unsharp(flat, 20, 20, 2, 0.5);
    expect(flat[(10 * 20 + 10) * 4]).toBe(120);
    const edge = image(20, 20, (x) => (x < 10 ? [100, 100, 100] : [160, 160, 160]));
    unsharp(edge, 20, 20, 2, 0.5);
    expect(edge[(10 * 20 + 9) * 4]).toBeLessThan(100); // dark side of the edge darker
    expect(edge[(10 * 20 + 10) * 4]).toBeGreaterThan(160); // light side lighter
    expect(edge[(10 * 20 + 2) * 4]).toBe(100); // far from the edge: unchanged
  });
});

describe("keeping the shopper's own skin", () => {
  it('recognises light to dark skin tones, not greys, blues or deep shadow', () => {
    const tones: [number, number, number][] = [[255, 224, 196], [234, 192, 134], [198, 134, 66], [141, 85, 36], [92, 58, 40], [60, 40, 30]];
    for (const [r, g, b] of tones) expect(isSkin(r, g, b)).toBe(true);
    const others: [number, number, number][] = [[120, 120, 120], [20, 60, 90], [20, 15, 12], [240, 240, 240]];
    for (const [r, g, b] of others) expect(isSkin(r, g, b)).toBe(false);
  });

  it('flags skin-coloured garments (beige, tan) but not navy or grey', () => {
    expect(skinColouredHex('#c0997c')).toBe(true);
    expect(skinColouredHex('#1f2a44')).toBe(false);
    expect(skinColouredHex('#808080')).toBe(false);
    expect(skinColouredHex(undefined)).toBe(false);
  });

  it('keeps skin that is in the same place in both, not skin the new garment now covers', () => {
    const tone: [number, number, number] = [198, 134, 66];
    // an arm: columns 10-29 skin in both; columns 40-59 skin before, sleeve after
    const before = image(w, h, (x) => ((x >= 10 && x < 30) || (x >= 40 && x < 60) ? tone : [120, 120, 120]));
    const after = image(w, h, (x) => (x >= 10 && x < 30 ? [tone[0] + 6, tone[1] + 4, tone[2]] : x >= 40 && x < 60 ? [20, 60, 90] : [120, 120, 120]));
    const skin = sameSkin(before, after, w, h);
    expect(skin[100 * w + 20]).toBeCloseTo(1, 2);
    expect(skin[100 * w + 50]).toBe(0);
    expect(skin[100 * w + 80]).toBe(0);
  });
});
