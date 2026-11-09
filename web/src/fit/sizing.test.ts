import { describe, expect, it } from 'vitest';
import type { BodySpec } from '@api/look';
import catalog from '../../public/catalog.json';
import { parseCatalog, type CatalogItem } from '../catalog/types';
import { chartSizes, easeFor, fitSummary, formatSize, lengthFor, recommendSize, shortSize, sizeAdvice } from './sizing';

const items = parseCatalog(catalog);
const item = (id: string): CatalogItem => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
// Default body from CLAUDE.md: 178 cm, 65 kg, chest 92, waist 75, hips 90, inseam 84.
const CALEB: BodySpec = { heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84 };

describe('recommendSize', () => {
  it('picks the smallest size whose body range covers the shopper', () => {
    expect(recommendSize(item('E453754-000'), CALEB)).toBe('S'); // Milano sweater: S fits chest 88-96
    expect(recommendSize(item('E453754-000'), { ...CALEB, chestCm: 97 })).toBe('M');
    expect(recommendSize(item('E475598-000'), CALEB)).toBe('S'); // Ultra Stretch Pants: S fits waist 68-76
    expect(recommendSize(item('E450251-000'), CALEB)).toBe('30inch'); // Slim chinos by waist
  });

  it('also respects the waist range a top lists', () => {
    // Crew Neck T-Shirt S: chest <= 96 and waist <= 76.
    expect(recommendSize(item('E422992-000'), CALEB)).toBe('S');
    expect(recommendSize(item('E422992-000'), { ...CALEB, waistCm: 80 })).toBe('M');
  });

  it('falls back to the largest size for a body above the chart, and to null without a chart', () => {
    expect(recommendSize(item('E453754-000'), { ...CALEB, chestCm: 150 })).toBe('3XL');
    expect(recommendSize({ ...item('E453754-000'), sizeChart: null }, CALEB)).toBeNull();
  });
});

describe('ease and length on this body', () => {
  it('reads ease from garment minus body circumference', () => {
    const milano = item('E453754-000'); // garment chest S 102, M 108, L 116, XL 124
    expect(easeFor(milano, 'XS', CALEB)).toBe('close'); // 96 - 92 = 4
    expect(easeFor(milano, 'S', CALEB)).toBe('regular'); // 10
    expect(easeFor(milano, 'M', CALEB)).toBe('relaxed'); // 16
    expect(easeFor(milano, 'XL', CALEB)).toBe('oversized'); // 32
    expect(easeFor(item('E450251-000'), '30inch', CALEB)).toBe('close'); // slim chinos, hips 94.5
    expect(easeFor(item('E479000-000'), '30inch', CALEB)).toBe('relaxed'); // barrel jeans, hips 111
  });

  it('steps from the recommended size when the chart has no garment numbers', () => {
    const bare = { ...item('E453754-000') };
    bare.sizeChart = Object.fromEntries(Object.entries(bare.sizeChart!).map(([k, v]) => [k, { ...v, garment: undefined }]));
    expect(easeFor(bare, 'S', CALEB)).toBe('regular');
    expect(easeFor(bare, 'XS', CALEB)).toBe('close');
    expect(easeFor(bare, 'L', CALEB)).toBe('oversized');
  });

  it('tells a cropped top and ankle pants from regular lengths', () => {
    expect(lengthFor(item('E487962-000'), 'S', CALEB)).toBe('cropped'); // Boxy Cropped T-Shirt, 63 cm
    expect(lengthFor(item('E422992-000'), 'S', CALEB)).toBe('regular'); // 69 cm on 178 cm
    expect(lengthFor(item('E422992-000'), 'XL', CALEB)).toBe('long'); // 77 cm
    expect(lengthFor(item('E475598-000'), 'S', CALEB)).toBe('ankle'); // 71 cm inseam vs 84 cm crotch height
    expect(lengthFor(item('E479000-000'), '30inch', CALEB)).toBe('full'); // 78.5
    expect(lengthFor(item('E450251-000'), '30inch', CALEB)).toBe('long'); // 86.5, sold unhemmed
    expect(lengthFor(item('E475598-000'), 'S', { ...CALEB, inseamCm: 95 })).toBe('cropped');
  });
});

describe('labels', () => {
  it('advises in plain words', () => {
    expect(sizeAdvice(item('E453754-000'), CALEB)).toEqual({ size: 'S', roomier: 'M', text: "You're an S; M if you want it roomier." });
    expect(sizeAdvice(item('E450251-000'), CALEB)?.text).toBe('You\'re a 30" waist; 31" if you want it roomier.');
    expect(sizeAdvice(item('E453754-000'), { ...CALEB, chestCm: 150 })?.text).toBe("You're a 3XL.");
  });

  it('formats inch sizes and fit summaries', () => {
    expect(formatSize('31inch')).toBe('31"');
    expect(formatSize('M')).toBe('M');
    expect(shortSize('31inch')).toBe('31');
    expect(fitSummary('regular', 'ankle')).toBe('Regular fit, ankle length on you');
    expect(fitSummary(undefined, 'regular')).toBe('Hip length on you');
    expect(fitSummary(undefined, undefined)).toBeNull();
  });

  it('lists only sizes with a chart row, in UNIQLO order', () => {
    expect(chartSizes(item('E453754-000'))).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(chartSizes({ ...item('E453754-000'), sizes: 'XS-XL' })).toEqual([]);
  });
});
