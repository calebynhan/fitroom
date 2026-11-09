import { describe, expect, it } from 'vitest';
import { fitWithin, PHOTO_GUIDE } from './prepare';

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
