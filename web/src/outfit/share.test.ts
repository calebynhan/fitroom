import { describe, expect, it } from 'vitest';
import { parseSaved } from './saved';
import { decodeSelection, outfitQuery, parseOutfitQuery, shareUrl } from './share';

describe('share links', () => {
  const outfit = {
    outfit: { top: { itemId: 'E453754-000', colorCode: '67', size: 'S' }, bottom: { itemId: 'E475598-000', colorCode: '09' } },
    scene: 'city' as const,
  };

  it('round-trips an outfit through the URL', () => {
    expect(outfitQuery(outfit)).toBe('?top=E453754-000.67.S&bottom=E475598-000.09&scene=city');
    expect(parseOutfitQuery(outfitQuery(outfit))).toEqual(outfit);
    expect(shareUrl(outfit, 'https://fitroom-woad.vercel.app')).toBe(
      'https://fitroom-woad.vercel.app/?top=E453754-000.67.S&bottom=E475598-000.09&scene=city',
    );
  });

  it('keeps inch sizes', () => {
    const o = { outfit: { bottom: { itemId: 'E450251-000', colorCode: '32', size: '30inch' } } };
    expect(parseOutfitQuery(outfitQuery(o))).toEqual(o);
  });

  it('carries nothing but the picks', () => {
    const q = outfitQuery(outfit);
    expect(q).not.toMatch(/data:|height|weight|cm|photo/i);
  });

  it('ignores malformed or foreign params', () => {
    expect(parseOutfitQuery('')).toBeNull();
    expect(parseOutfitQuery('?utm_source=x')).toBeNull();
    expect(parseOutfitQuery('?top=<script>')).toBeNull();
    expect(decodeSelection('E453754-000')).toBeNull();
    expect(decodeSelection('E45375-000.67')).toBeNull();
    expect(decodeSelection('E453754-000.67.<b>')).toBeNull();
    expect(parseOutfitQuery('?bottom=E475598-000.09&scene=moon')).toEqual({ outfit: { bottom: { itemId: 'E475598-000', colorCode: '09' } } });
  });
});

describe('saved outfits', () => {
  it('drops malformed entries from storage', () => {
    const good = { id: 'a', name: 'Sweater + Pants', outfit: { top: { itemId: 'E453754-000', colorCode: '67' } }, scene: 'night', savedAt: 1 };
    expect(parseSaved([good, null, { id: 'b' }, { ...good, id: 'c', outfit: { top: { itemId: 'x', colorCode: '1' } } }])).toEqual([good]);
    expect(parseSaved('nope')).toEqual([]);
    expect(parseSaved([{ ...good, scene: 'moon' }])[0].scene).toBe('studio');
  });
});
