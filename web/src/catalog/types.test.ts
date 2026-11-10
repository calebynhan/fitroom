import { describe, expect, it } from 'vitest';
import catalog from '../../public/catalog.json';
import { colorLabel, parseCatalog } from './types';

const items = parseCatalog(catalog);

describe('colour labels', () => {
  it('add the colour code only where the name repeats', () => {
    const crew = items.find((i) => i.id === 'E422992-000')!;
    const blues = crew.colors.filter((c) => c.name === 'Blue');
    expect(blues.length).toBeGreaterThan(1);
    expect(blues.map((c) => colorLabel(crew, c.code))).toEqual(blues.map((c) => `Blue (${c.code})`));
    const unique = crew.colors.find((c) => crew.colors.filter((d) => d.name === c.name).length === 1)!;
    expect(colorLabel(crew, unique.code)).toBe(unique.name);
  });

  it('make every colourway of every item distinguishable', () => {
    for (const item of items) {
      const labels = item.colors.map((c) => colorLabel(item, c.code));
      expect(new Set(labels).size, item.name).toBe(labels.length);
    }
  });
});
