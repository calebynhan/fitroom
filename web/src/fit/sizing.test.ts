import { describe, expect, it } from 'vitest';
import type { BodySpec } from '@api/look';
import catalog from '../../public/catalog.json';
import { parseCatalog, type CatalogItem } from '../catalog/types';
import type { SizingBody, SlotPrefs } from '../body/profile';
import { chartSizes, easeFor, fitSummary, formatSize, lengthFor, pickSize, recommendSize, shortSize, sizeAdvice, sizeDelta, sizePair } from './sizing';

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

  it('sizes tops on chest when the waist is only estimated', () => {
    const estimatedWaist = { ...CALEB, waistCm: 80, measured: { chestCm: true, waistCm: false, hipsCm: false, inseamCm: false } };
    expect(recommendSize(item('E422992-000'), estimatedWaist)).toBe('S'); // the estimate doesn't push it to M
    expect(recommendSize(item('E422992-000'), { ...estimatedWaist, measured: { ...estimatedWaist.measured, waistCm: true } })).toBe('M');
  });

  it('says so, and renders it tight, when no size is made for this body', () => {
    const big = { ...CALEB, waistCm: 109.5, hipsCm: 113 };
    const advice = sizeAdvice(item('E479000-000'), big); // Barrel Jeans top out at a 34" waist (86.5 cm)
    expect(advice).toMatchObject({ size: '34inch', fits: false, compare: null });
    expect(advice!.text).toMatch(/^Runs small for you: even the largest size \(34" waist\)/);
    expect(easeFor(item('E479000-000'), '34inch', big)).toBe('close');
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
    expect(sizeAdvice(item('E453754-000'), CALEB)).toEqual({
      size: 'S',
      chart: 'S',
      compare: 'M',
      fits: true,
      reason: 'chart',
      text: "You're an S; M if you want it roomier.",
    });
    expect(sizeAdvice(item('E450251-000'), CALEB)?.text).toBe('You\'re a 30" waist; 31" if you want it roomier.');
    expect(sizeAdvice(item('E450543-000'), CALEB)?.fits).toBe(true);
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

describe('fit preferences', () => {
  const MILANO = 'E453754-000'; // garment chest S 102, M 108; body ranges XS 80-88, S 88-96
  const pref = (p: SlotPrefs['pref'], extra: Partial<SlotPrefs> = {}): SlotPrefs => ({ pref: p, ...extra });

  it('keeps the chart size for a regular fit', () => {
    expect(pickSize(item(MILANO), CALEB, pref('regular'))).toEqual({ size: 'S', chart: 'S', fits: true, reason: 'chart' });
    expect(sizeAdvice(item(MILANO), CALEB, pref('regular'))?.text).toBe("You're an S; M if you want it roomier.");
  });

  it('sizes up until the garment reads relaxed', () => {
    // S leaves 10 cm at the chest (regular), M 16 cm (relaxed)
    const advice = sizeAdvice(item(MILANO), CALEB, pref('relaxed'));
    expect(advice).toMatchObject({ size: 'M', chart: 'S', reason: 'relaxed', compare: 'S' });
    expect(advice?.text).toBe("M for the relaxed fit you like; S by UNIQLO's chart.");
    // Barrel jeans are cut relaxed already: no size up needed
    expect(pickSize(item('E479000-000'), CALEB, pref('relaxed'))?.size).toBe(recommendSize(item('E479000-000'), CALEB));
  });

  it('sizes down for a close fit only when the smaller size is nearly made for this body', () => {
    expect(pickSize(item(MILANO), CALEB, pref('close'))?.size).toBe('S'); // XS is made for up to 88, Caleb is 92
    expect(sizeAdvice(item(MILANO), CALEB, pref('close'))?.text).toBe("You're an S; a size down would be too small.");
    const between: SizingBody = { ...CALEB, chestCm: 89 };
    expect(sizeAdvice(item(MILANO), between, pref('close'))).toMatchObject({ size: 'XS', chart: 'S', reason: 'close', compare: 'S' });
  });

  it('matches a garment of their own that fits well, by chest then length', () => {
    // A tee 53 cm across (106 around), 69 cm long: Crew Neck S is 106 / 69, Milano M (108 / 68) beats S (102 / 65)
    const tee = pref('regular', { chestCm: 106, lengthCm: 69 });
    expect(sizeAdvice(item('E422992-000'), CALEB, tee)).toMatchObject({ size: 'S', reason: 'reference', text: "You're an S, the closest to the top you measured." });
    expect(sizeAdvice(item(MILANO), CALEB, tee)).toMatchObject({ size: 'M', chart: 'S', text: "M is the closest to the top you measured; S by UNIQLO's chart." });
    // the measured garment wins over the preference
    expect(pickSize(item(MILANO), CALEB, { ...tee, pref: 'close' })?.size).toBe('M');
    // pants by hips: Ultra Stretch S 98, M 104 against a 100 cm pair
    expect(sizeAdvice(item('E475598-000'), CALEB, pref('regular', { hipsCm: 100 }))?.text).toBe("You're an S, the closest to the pants you measured.");
  });

  it('ignores preferences when no size is made for this body', () => {
    const big = { ...CALEB, waistCm: 109.5, hipsCm: 113 };
    expect(pickSize(item('E479000-000'), big, pref('relaxed'))).toMatchObject({ size: '34inch', fits: false, reason: 'chart' });
  });
});

describe('size comparison', () => {
  it('compares a hand-picked size with the pick, and the pick with the next size', () => {
    const advice = sizeAdvice(item('E453754-000'), CALEB)!;
    expect(sizePair(undefined, advice)).toEqual({ size: 'S', compare: 'M' });
    expect(sizePair('L', advice)).toEqual({ size: 'L', compare: 'S' });
    const largest = sizeAdvice(item('E453754-000'), { ...CALEB, chestCm: 133 })!; // 3XL, the largest
    expect(sizePair(undefined, largest)?.compare).toBe('XXL'); // nothing roomier: one size down
    expect(sizePair(undefined, null)).toBeNull();
  });

  it('gives the garment differences a comparison photo must show', () => {
    expect(sizeDelta(item('E453754-000'), 'S', 'M')).toEqual({ chestCm: 6, lengthCm: 3 });
    expect(sizeDelta(item('E475598-000'), 'M', 'S')).toEqual({ hipsCm: -6, inseamCm: -2 });
    expect(sizeDelta(item('E475598-000'), 'S', 'nope')).toBeUndefined();
  });
});
