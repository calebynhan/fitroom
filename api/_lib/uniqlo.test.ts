import { describe, expect, it } from 'vitest';
import { fallbackHex, mapShape, parseProductId, swatchUrl, toCatalogItem, type UniqloDetails } from './uniqlo';

describe('parseProductId', () => {
  it('extracts the ID from a product URL', () => {
    expect(parseProductId('https://www.uniqlo.com/us/en/products/E453754-000/00?colorDisplayCode=09')).toBe('E453754-000');
  });
  it('accepts a bare ID, a missing E and a 6-digit number', () => {
    expect(parseProductId('E479000-000')).toBe('E479000-000');
    expect(parseProductId('479000-000')).toBe('E479000-000');
    expect(parseProductId(' 455365 ')).toBe('E455365-000');
  });
  it('rejects text without an ID', () => {
    expect(parseProductId('https://www.uniqlo.com/us/en/')).toBeNull();
    expect(parseProductId('')).toBeNull();
  });
});

describe('mapShape', () => {
  it('maps categories to shapes', () => {
    expect(mapShape('T-Shirts, Sweats & Fleece T-Shirts')?.shape).toBe('tee');
    expect(mapShape('Sweaters & Knitwear Sweaters & Cardigans')?.shape).toBe('sweater');
    expect(mapShape('Bottoms Easy Pants')).toEqual({ shape: 'pants', slot: 'bottom', fabric: 'twill' });
    expect(mapShape('Bottoms Jeans')).toEqual({ shape: 'pants', slot: 'bottom', fabric: 'denim' });
  });
  it('refines fabric from the product name', () => {
    expect(mapShape('Sweaters & Knitwear', 'Cashmere Sweater')?.fabric).toBe('cashmere');
  });
  it('returns null for unsupported categories', () => {
    expect(mapShape('Outerwear Jackets', 'Puffer Jacket')).toBeNull();
  });
});

describe('fallbackHex', () => {
  it('goes light to dark within a family', () => {
    expect(fallbackHex('00')).toBe('#f2f2f0');
    expect(fallbackHex('09')).toBe('#2b2b2b');
    expect(fallbackHex('69')).toBe('#1d2a44');
  });
  it('handles odd input safely', () => {
    expect(fallbackHex('COL03')).toMatch(/^#[0-9a-f]{6}$/);
    expect(fallbackHex('')).toBe('#f2f2f0');
  });
});

const RAW: UniqloDetails = {
  name: 'Washable Milano Ribbed Sweater',
  prices: { base: { value: 49.9 }, promo: { value: 39.9 } },
  breadcrumbs: {
    class: { locale: 'Sweaters & Knitwear', name: 'sweaters' },
    category: { locale: 'Sweaters & Cardigans', name: 'sweaters and cardigans' },
  },
  colors: [{ displayCode: '09', name: 'BLACK' }, { displayCode: '69', name: 'NAVY' }, { name: 'NO CODE' }],
  sizes: [{ name: 'S' }, { name: 'M' }],
  images: { main: { '09': { image: 'https://image.uniqlo.com/x.jpg' } } },
};

describe('toCatalogItem', () => {
  it('builds a catalog item matching the contract', () => {
    const out = toCatalogItem('E453754-000', RAW, () => '#123456');
    expect('item' in out).toBe(true);
    if (!('item' in out)) return;
    expect(out.item).toMatchObject({
      id: 'E453754-000',
      name: 'Washable Milano Ribbed Sweater',
      price: 49.9,
      salePrice: 39.9,
      slot: 'top',
      shape: 'sweater',
      fabric: 'rib_knit',
      url: 'https://www.uniqlo.com/us/en/products/E453754-000/00',
      sizes: ['S', 'M'],
    });
    expect(out.item.colors).toEqual([
      { code: '09', name: 'Black', hex: '#123456', swatch: swatchUrl('E453754-000', '09') },
      { code: '69', name: 'Navy', hex: '#123456', swatch: swatchUrl('E453754-000', '69') },
    ]);
  });
  it('drops promo prices that are not lower than base', () => {
    const out = toCatalogItem('E453754-000', { ...RAW, prices: { base: { value: 19.9 }, promo: { value: 19.9 } } });
    expect('item' in out && out.item.salePrice).toBeNull();
  });
  it('explains unsupported categories', () => {
    const out = toCatalogItem('E111111-000', {
      ...RAW,
      name: 'Puffer Jacket',
      breadcrumbs: { class: { locale: 'Outerwear' }, category: { locale: 'Jackets' } },
    });
    expect(out).toEqual({ error: 'Puffer Jacket (Jackets) is not supported yet. Try a T-shirt, sweater or pants.' });
  });
  it('rejects responses without name or price', () => {
    expect('error' in toCatalogItem('E1', { ...RAW, name: undefined })).toBe(true);
    expect('error' in toCatalogItem('E1', { ...RAW, prices: {} })).toBe(true);
  });
});
