import { describe, expect, it } from 'vitest';
import catalog from '../../public/catalog.json';
import type { SizingBody } from '../body/profile';
import { parseCatalog, type CatalogItem } from '../catalog/types';
import { fitCard, formatDiff, formatLength } from './fitCard';

const items = parseCatalog(catalog);
const item = (id: string): CatalogItem => items.find((i) => i.id === id)!;
const MEASURED = { chestCm: true, waistCm: true, hipsCm: true, inseamCm: true };
const CALEB: SizingBody = { heightCm: 178, weightKg: 65, chestCm: 92, waistCm: 75, hipsCm: 90, inseamCm: 84, measured: MEASURED };

describe('fit card', () => {
  it('puts a top in numbers: chest room, where the hem lands, shoulders and sleeve', () => {
    const card = fitCard(item('E453754-000'), ['S', 'M'], CALEB, 'metric')!;
    expect(card.sizes).toEqual(['S', 'M']);
    expect(card.rows.map((r) => r.label)).toEqual(['Chest room', 'Length', 'Shoulders', 'Sleeve']);
    expect(card.rows[0].cells).toEqual([
      { main: '10 cm', sub: 'regular' },
      { main: '16 cm', sub: 'relaxed' },
    ]);
    // 0.39 x 178 = 69.4 cm to the hip
    expect(card.rows[1].cells).toEqual([
      { main: '65 cm', sub: '4.5 cm above hip' },
      { main: '68 cm', sub: 'at the hip' },
    ]);
    expect(card.rows[2].cells.map((c) => c.main)).toEqual(['43 cm', '44.5 cm']);
    expect(card.notes).toEqual(['Room = garment measurement minus yours, all the way around.']);
  });

  it('puts pants in numbers: the waist range, hip room and length', () => {
    const card = fitCard(item('E475598-000'), ['S', 'M'], CALEB, 'metric')!;
    expect(card.rows.map((r) => r.label)).toEqual(['Waist', 'Hip room', 'Inseam', 'Thigh']);
    expect(card.rows[0].cells).toEqual([
      { main: '68–76 cm', sub: 'fits your waist' },
      { main: '76–84 cm', sub: 'loose by 1 cm' },
    ]);
    expect(card.rows[1].cells[0]).toEqual({ main: '8 cm', sub: 'regular' });
    // inseam 71 vs 84 - 4 = 80: 9 cm short
    expect(card.rows[2].cells[0]).toEqual({ main: '71 cm', sub: 'ankle length' });
  });

  it('speaks inches, says when a size is tight, and flags estimated measurements', () => {
    const estimated: SizingBody = { ...CALEB, chestCm: 104, measured: { ...MEASURED, chestCm: false } };
    const card = fitCard(item('E453754-000'), ['S'], estimated, 'imperial')!;
    expect(card.rows[0].cells[0]).toEqual({ main: '1 in tight', sub: 'close' });
    expect(card.notes[1]).toMatch(/estimated chest/);
    const pants = fitCard(item('E475598-000'), ['S'], { ...CALEB, measured: { ...MEASURED, waistCm: false, inseamCm: false } }, 'metric')!;
    expect(pants.notes[1]).toBe('Your waist and inseam are estimated from height and weight; measure for exact numbers.');
  });

  it('compares with a garment of their own when they measured one', () => {
    const card = fitCard(item('E453754-000'), ['S', 'M'], CALEB, 'metric', { pref: 'regular', chestCm: 106, lengthCm: 69 })!;
    const versus = card.rows.find((r) => r.label === 'vs your top')!;
    expect(versus.cells).toEqual([
      { main: '−4 cm chest', sub: '−4 cm length' },
      { main: '+2 cm chest', sub: '−1 cm length' },
    ]);
  });

  it('needs every size in the chart', () => {
    expect(fitCard(item('E453754-000'), ['S', 'nope'], CALEB, 'metric')).toBeNull();
    expect(fitCard({ ...item('E453754-000'), sizeChart: null }, ['S'], CALEB, 'metric')).toBeNull();
  });

  it('formats lengths and differences', () => {
    expect(formatLength(10, 'imperial')).toBe('4 in');
    expect(formatLength(-0.1, 'metric')).toBe('0 cm');
    expect(formatDiff(0.2, 'metric')).toBe('same');
    expect(formatDiff(-2.54, 'imperial')).toBe('−1 in');
  });
});
