import { describe, expect, it } from 'vitest';
import { spaceList, spaceRef } from './space';

describe('spaceRef', () => {
  it("derives the Space's URLs like Hugging Face does", () => {
    expect(spaceRef('fashn-ai/fashn-vton-1.5')).toEqual({
      id: 'fashn-ai/fashn-vton-1.5',
      url: 'https://fashn-ai-fashn-vton-1-5.hf.space/',
      page: 'https://huggingface.co/spaces/fashn-ai/fashn-vton-1.5',
    });
    expect(spaceRef('https://huggingface.co/spaces/CalebN/FitRoom_VTON')?.url).toBe('https://calebn-fitroom-vton.hf.space/');
    expect(spaceRef('not a space')).toBeNull();
  });
});

describe('spaceList', () => {
  it('uses our own Space first and keeps FASHN as the fallback', () => {
    expect(spaceList(undefined).map((s) => s.id)).toEqual(['fashn-ai/fashn-vton-1.5']);
    expect(spaceList('').map((s) => s.id)).toEqual(['fashn-ai/fashn-vton-1.5']);
    expect(spaceList('me/fashn-vton-1.5').map((s) => s.id)).toEqual(['me/fashn-vton-1.5', 'fashn-ai/fashn-vton-1.5']);
    expect(spaceList('fashn-ai/fashn-vton-1.5')).toHaveLength(1);
    expect(spaceList('garbage!!').map((s) => s.id)).toEqual(['fashn-ai/fashn-vton-1.5']);
  });
});
