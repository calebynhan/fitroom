import { describe, expect, it } from 'vitest';
import { downloadName } from './download';

describe('download names', () => {
  it('match the image type', () => {
    expect(downloadName('front', 'data:image/jpeg;base64,AA')).toBe('fitroom-front.jpg');
    expect(downloadName('three_quarter', 'data:image/webp;base64,AA')).toBe('fitroom-three-quarter.webp');
    expect(downloadName('side')).toBe('fitroom-side.jpg');
  });
});
