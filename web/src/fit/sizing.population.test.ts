// Invariants of the size pick over every catalog item x 100 men's bodies (155-200 cm, BMI 17-35). From the
// 2026-11-10 quality audit (docs/quality-audit.md): these held then and must keep holding.
import { describe, expect, it } from 'vitest';
import catalog from '../../public/catalog.json';
import { EMPTY_PROFILE, fitPrefs, sizingBody, type Profile } from '../body/profile';
import { parseCatalog } from '../catalog/types';
import { fitCard } from './fitCard';
import { chartSizes, pickSize, sizeAdvice } from './sizing';

const SD = { chestCm: 3.2, waistCm: 4.4 } as const;

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

  // Stretch tees (AIRism T-Shirt) are cut smaller than the body on purpose: the fit card used to call the recommended
  // size "N cm tight" (75 cases in the 2026-11-10 audit). Inside its own range it is a stretch fit, not tight.
  it('never calls a size tight when the body is inside its range', () => {
    let stretch = 0;
    for (const item of items) {
      for (const p of bodies) {
        const body = sizingBody(p)!;
        const pick = pickSize(item, body)!;
        if (!pick.fits) continue;
        const card = fitCard(item, [pick.size], body, 'metric')!;
        const room = card.rows[item.slot === 'top' ? 0 : 1]?.cells[0];
        expect(room?.main ?? '', `${item.name} ${p.heightCm}/${p.weightKg} ${pick.size}`).not.toMatch(/tight/);
        if (room?.main.startsWith('stretches')) stretch += 1;
      }
    }
    expect(stretch).toBeGreaterThan(0); // the stretch wording is actually reached
  });

  // Phase 2 gate (docs/quality-audit.md): with estimated measurements, every size that a 1-SD error in the deciding
  // measurement would change is labelled borderline; none flips silently. Typed measurements are never flagged.
  it('labels every size that rests on an estimate near a boundary, and only those', () => {
    let flips = 0;
    let labelled = 0;
    for (const item of items) {
      const measure = item.slot === 'top' ? 'chestCm' : 'waistCm';
      for (const p of bodies) {
        for (const pref of ['close', 'regular', 'relaxed'] as const) {
          const body = sizingBody(p)!; // only height + weight: everything else estimated
          const prefs = { pref };
          const advice = sizeAdvice(item, body, prefs)!;
          if (!advice.fits) continue;
          const shifted = [-SD[measure], SD[measure]].map((d) => pickSize(item, { ...body, [measure]: body[measure] + d }, prefs));
          const flipped = shifted.some((o) => o?.fits && o.size !== advice.size);
          if (flipped) flips += 1;
          expect(Boolean(advice.borderline), `${item.name} ${p.heightCm}/${p.weightKg} ${pref}`).toBe(flipped);
          if (advice.borderline) {
            labelled += 1;
            expect(advice.text).toMatch(/^(Between|Anywhere from) .+ is estimated/);
            expect(advice.borderline.sizes).toContain(advice.size);
          }
          // typed in: the shopper's own number decides, no flag
          const typed = sizingBody({ ...p, [measure]: body[measure] })!;
          expect(sizeAdvice(item, typed, prefs)!.borderline).toBeUndefined();
        }
      }
    }
    expect(flips).toBeGreaterThan(0);
    expect(labelled).toBe(flips);
  });
});
