import { describe, expect, it } from 'vitest';
import { fitWithin, PHOTO_GUIDE, photoWarning } from './prepare';

describe('fitWithin', () => {
  it('scales the long side down to the cap', () => {
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(4032, 3024, 768)).toEqual({ width: 768, height: 576 });
  });
  it('never upscales', () => {
    expect(fitWithin(600, 900, 1024)).toEqual({ width: 600, height: 900 });
  });
  it('keeps body photos larger than the face close-up', () => {
    expect(PHOTO_GUIDE.front.maxSide).toBeGreaterThan(PHOTO_GUIDE.face.maxSide);
  });
});

describe('photo budgets and warnings', () => {
  it('gives the front photo the most pixels (the front shot keeps its face) within the request budget', () => {
    expect(PHOTO_GUIDE.front.maxSide).toBe(1536);
    const total = PHOTO_GUIDE.front.maxChars + PHOTO_GUIDE.side.maxChars + PHOTO_GUIDE.face.maxChars + 900_000; // + front shot
    expect(total).toBeLessThanOrEqual(4_000_000);
  });

  it('warns about landscape body photos, where the person is small', () => {
    expect(photoWarning('side', { width: 2000, height: 1500 })).toMatch(/landscape/);
    expect(photoWarning('front', { width: 864, height: 1536 })).toBeNull();
    expect(photoWarning('face', { width: 1200, height: 900 })).toBeNull();
  });
});
