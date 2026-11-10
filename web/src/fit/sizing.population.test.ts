// Invariants of the size pick over every catalog item x 100 men's bodies (155-200 cm, BMI 17-35). From the
// 2026-11-10 quality audit (docs/quality-audit.md): these held then and must keep holding.
import { describe, expect, it } from 'vitest';
import catalog from '../../public/catalog.json';
import { EMPTY_PROFILE, fitPrefs, sizingBody, type Profile } from '../body/profile';
import { parseCatalog } from '../catalog/types';
import { fitCard } from './fitCard';
import { chartSizes, pickSize, sizeAdvice } from './sizing';

const items = parseCatalog(catalog);
const bodies: Profile[] = [];
for (let h = 155; h <= 200; h += 5) for (let bmi = 17; bmi <= 35; bmi += 2) bodies.push({ ...EMPTY_PROFILE, heightCm: h, weightKg: Math.round(bmi * (h / 100) ** 2) });

describe('size pick across a population', () => {
  it('always gives an answer and a fit card without NaN or blanks', () => {
    for (const item of items) {
      expect(chartSizes(item).length, item.name).toBeGreaterThan(0);
      for (const p of bodies) {
        const body = sizingBody(p)!;
        const advice = sizeAdvice(item, body, fitPrefs(p)[item.slot]);
        expect(advice, `${item.name} ${p.heightCm}/${p.weightKg}`).not.toBeNull();
        const card = fitCard(item, advice!.compare ? [advice!.size, advice!.compare] : [advice!.size], body, 'metric')!;
        for (const row of card.rows) for (const c of row.cells) expect(`${c.main} ${c.sub ?? ''}`, item.name).not.toMatch(/NaN|undefined|Infinity|—/);
      }
    }
  });

  it('never gives a heavier body a smaller size', () => {
    for (const item of items) {
      const sizes = chartSizes(item);
      for (const p of bodies) {
        const light = pickSize(item, sizingBody(p)!)!;
        const heavy = pickSize(item, sizingBody({ ...p, weightKg: Math.min(180, (p.weightKg ?? 0) + 10) })!)!;
        expect(sizes.indexOf(heavy.size), `${item.name} ${p.heightCm}/${p.weightKg}`).toBeGreaterThanOrEqual(sizes.indexOf(light.size));
      }
    }
  });

  it('orders preferences: close <= regular <= relaxed', () => {
    for (const item of items) {
      const sizes = chartSizes(item);
      for (const p of bodies) {
        const at = (pref: 'close' | 'regular' | 'relaxed') => sizes.indexOf(pickSize(item, sizingBody(p)!, { pref })!.size);
        expect(at('close'), item.name).toBeLessThanOrEqual(at('regular'));
        expect(at('regular'), item.name).toBeLessThanOrEqual(at('relaxed'));
      }
    }
  });

  // Known gap (audit): stretch tees (AIRism T-Shirt) are cut smaller than the body on purpose, and the fit card calls
  // the recommended size "N cm tight". Turn this on once the card words designed negative ease as a stretch fit.
  it.todo('never calls the recommended size tight when the body is inside its range');
});
