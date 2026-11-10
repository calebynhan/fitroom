import { describe, expect, it } from 'vitest';
import { describeSpaceError, describeStatus, garmentUrl } from './space';

describe('Space errors', () => {
  it('recognises the ZeroGPU allowance running out', () => {
    const e = describeSpaceError('You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota');
    expect(e).toMatchObject({ quota: true, retryable: true });
    expect(e.message).toMatch(/free GPU time for your connection is used up/);
    expect(e.detail).toMatch(/ZeroGPU/);
  });

  it('tells a busy queue and a sleeping Space apart from a bad photo', () => {
    expect(describeSpaceError('Queue is full').message).toMatch(/busy/);
    expect(describeSpaceError('Space metadata could not be loaded.').message).toMatch(/waking up or unreachable/);
    expect(describeSpaceError('Please upload a person image')).toMatchObject({ retryable: false, quota: false });
    expect(describeSpaceError(undefined)).toMatchObject({ retryable: true, quota: false, detail: null });
  });
});

describe('garment photos', () => {
  it('routes UNIQLO product photos through the same-site proxy', () => {
    expect(garmentUrl('https://image.uniqlo.com/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg')).toBe(
      '/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg',
    );
    expect(garmentUrl('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
  });
});

describe('queue status', () => {
  it('says where the shopper is in line', () => {
    expect(describeStatus({ kind: 'running' })).toBe('Dressing you…');
    expect(describeStatus({ kind: 'queued', position: 0, etaS: 23 })).toBe('Starting the free GPU…');
    expect(describeStatus({ kind: 'queued', position: 2, etaS: 80 })).toBe('Third in line · about 1 min');
    expect(describeStatus({ kind: 'queued', position: 9, etaS: null })).toBe('10th in line');
  });
});
