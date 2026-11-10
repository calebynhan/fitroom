import { describe, expect, it } from 'vitest';
import { fallbackHex, mapFit, mapShape, parseProductId, swatchUrl, toCatalogItem, type UniqloDetails } from './uniqlo';

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
  it('does not carve an ID out of a longer number', () => {
    expect(parseProductId('1234567-000')).toBeNull();
    expect(parseProductId('E453754-0001')).toBeNull();
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
  it('rejects bottoms and tops our meshes would misrepresent (shorts, tights, vests, tanks)', () => {
    expect(mapShape('Bottoms Shorts', 'Chino Shorts | 8.5"')).toBeNull();
    expect(mapShape('Bottoms Sweatpants', 'Wide Sweat Shorts')).toBeNull();
    expect(mapShape('Bottoms Jeans', 'Jorts | 13"')).toBeNull();
    expect(mapShape('Bottoms Leggings & Tights', 'HEATTECH Tights')).toBeNull();
    expect(mapShape('Sweaters & Knitwear Sweaters & Cardigans', 'Knitted Vest')).toBeNull();
    expect(mapShape('T-Shirts, Sweats & Fleece T-Shirts', 'DRY Color Ribbed Tank Top')).toBeNull();
    expect(mapShape('T-Shirts, Sweats & Fleece T-Shirts Sleeveless', 'AIRism Cotton T-Shirt | Sleeveless')).toBeNull();
  });
  it('rejects skirts and dresses even though they sit under Bottoms / T-shirts', () => {
    expect(mapShape('Bottoms Skirts', 'Satin Narrow Skirt')).toBeNull();
    expect(mapShape('Dresses & Jumpsuits', 'Mercerized Cotton T-Shirt Dress')).toBeNull();
    expect(mapShape('Bottoms Dress Pants', 'Smart Pants')?.shape).toBe('pants');
  });
  it('falls back to the product name when the category is a collection or technology line', () => {
    expect(mapShape('Uniqlo U', 'AIRism Cotton T-Shirt | Long Sleeve', 'long')).toEqual({ shape: 'sweater', slot: 'top', fabric: 'jersey' });
    expect(mapShape('AIRism Tops', 'AIRism T-Shirt')?.shape).toBe('tee');
    expect(mapShape('Uniqlo U', 'Wide Cargo Pants')?.shape).toBe('pants');
    expect(mapShape('Polo Shirts', 'Rugger Shirt')).toBeNull();
  });
  it('rejects outerwear, hoodies and open-front tops even when the class says T-Shirts or Knit', () => {
    expect(mapShape('T-Shirts, Sweats & Fleece Sweatshirts & Hoodies', 'Sweat Pullover Hoodie')).toBeNull();
    expect(mapShape('T-Shirts, Sweats & Fleece Fleece', 'Fleece Full-Zip Jacket')).toBeNull();
    expect(mapShape('Outerwear Jackets & Parkas', 'Knitted Jacket')).toBeNull();
    expect(mapShape('Shirts Dress Shirts', 'Easy Care Dress Shirt')).toBeNull();
    expect(mapShape('T-Shirts', 'AIRism Cotton T-Shirt', 'sleeveless')).toBeNull();
  });
  it('rejects cardigans, button-up shirts (even denim ones) and underwear', () => {
    expect(mapShape('Sweaters & Knitwear Sweaters & Cardigans', 'Souffle Yarn Cardigan')).toBeNull();
    expect(mapShape('Shirts Casual Shirts', 'Denim Shirt')).toBeNull();
    expect(mapShape('Innerwear & Underwear Boxers & Briefs', 'AIRism Boxer Briefs')).toBeNull();
    expect(mapShape('AIRism Bottoms', 'AIRism Ultra Seamless Boxer Briefs')).toBeNull();
    expect(mapShape('Bottoms Jeans', 'Straight Jeans')?.shape).toBe('pants');
  });
  it('does not read "Sweatshirts" as T-shirts; sweatshirts go on the long-sleeve mesh in jersey', () => {
    expect(mapShape('T-Shirts, Sweats & Fleece Sweatshirts & Hoodies', 'Sweatshirt')).toEqual({ shape: 'sweater', slot: 'top', fabric: 'jersey' });
  });
  it('puts short-sleeve knits on the tee mesh with knit fabric', () => {
    expect(mapShape('Sweaters & Knitwear Sweaters & Cardigans', 'Washable Milano Ribbed Knitted T-Shirt')).toEqual({
      shape: 'tee',
      slot: 'top',
      fabric: 'rib_knit',
    });
    expect(mapShape('Sweaters & Knitwear', 'Souffle Yarn Polo Sweater', 'short')?.shape).toBe('tee');
  });
  it('picks pants fabric from the name: sweatpants are jersey, corduroy is not denim', () => {
    expect(mapShape('Bottoms Sweatpants', 'Wide Sweatpants')?.fabric).toBe('jersey');
    expect(mapShape('Bottoms Easy Pants', 'Jersey Easy Work Pants')?.fabric).toBe('jersey');
    expect(mapShape('Bottoms Jeans', 'Barrel Jeans | Corduroy')?.fabric).toBe('twill');
  });
  it('does not confuse "Short Sleeve" or petite "Short" lengths with shorts', () => {
    expect(mapShape('T-Shirts, Sweats & Fleece T-Shirts Short Sleeve', 'HEATTECH T-Shirt | Short Sleeve')?.shape).toBe('tee');
    expect(mapShape('Bottoms Jeans', 'Baggy Barrel Jeans | Short')?.shape).toBe('pants');
  });
  it('puts long-sleeve T-shirts on the long-sleeve (sweater) mesh, keeping jersey fabric', () => {
    expect(mapShape('T-Shirts', 'Soft Brushed T-Shirt | Long Sleeve')).toEqual({ shape: 'sweater', slot: 'top', fabric: 'jersey' });
    expect(mapShape('T-Shirts', 'Waffle T-Shirt', 'long')).toEqual({ shape: 'sweater', slot: 'top', fabric: 'jersey' });
    expect(mapShape('T-Shirts', 'Crew Neck T-Shirt', 'short')?.shape).toBe('tee');
  });
});

describe('mapFit', () => {
  it('reads the top-fit / bottom-fit tag', () => {
    expect(mapFit([{ group: 'top-fit', tag: 'regular' }], 'Crew Neck T-Shirt')).toBe('regular');
    expect(mapFit([{ group: 'bottom-fit', tag: 'baggy' }], 'Barrel Jeans')).toBe('relaxed');
    expect(mapFit([{ group: 'top-fit', tag: 'oversized' }], 'Tee')).toBe('relaxed');
    expect(mapFit([{ group: 'bottom-fit', tag: 'slim' }], 'Jeans')).toBe('slim');
    expect(mapFit([{ group: 'bottom-fit', tag: 'skinny' }], 'Jeans')).toBe('slim');
  });
  it('falls back to the product name, then regular', () => {
    expect(mapFit([], 'Slim Chino Pants')).toBe('slim');
    expect(mapFit(undefined, 'AIRism Cotton Oversized T-Shirt')).toBe('relaxed');
    expect(mapFit([{ group: 'material', tag: 'cotton' }], 'Pleated Wide Pants')).toBe('relaxed');
    expect(mapFit([], 'Crew Neck T-Shirt')).toBe('regular');
  });
  it('lets the name win over a generic "regular" tag for clearly slim or loose cuts', () => {
    expect(mapFit([{ group: 'bottom-fit', tag: 'regular' }], 'Slim Straight Jeans')).toBe('slim');
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
      { code: '09', name: 'Black', hex: '#123456', swatch: swatchUrl('E453754-000', '09'), image: 'https://image.uniqlo.com/x.jpg' },
      { code: '69', name: 'Navy', hex: '#123456', swatch: swatchUrl('E453754-000', '69') },
    ]);
    expect(out.item.fit).toBe('regular');
    expect(out.item.sizeChart).toBeNull();
  });
  it("refuses items UNIQLO sizes for women, and keeps men's and unisex ones", () => {
    expect(toCatalogItem('E479000-000', { ...RAW, name: 'Barrel Jeans', sizeGender: 'WOMEN' })).toEqual({
      error: "Barrel Jeans is sized for women. FitRoom sizes men's clothes for now.",
    });
    expect('item' in toCatalogItem('E453754-000', { ...RAW, sizeGender: 'MEN' })).toBe(true);
    expect('item' in toCatalogItem('E453754-000', { ...RAW, sizeGender: 'UNISEX' })).toBe(true);
  });
  it('carries the fit tag and a parsed size chart', () => {
    const chart = { M: { chestCm: 104, body: { chestCm: [96, 104] as [number, number] } } };
    const raw = { ...RAW, tags: [{ group: 'top-fit', tag: 'relaxed', tagName: 'Relaxed' }] };
    const out = toCatalogItem('E453754-000', raw, () => '#123456', chart);
    expect('item' in out && out.item.fit).toBe('relaxed');
    expect('item' in out && out.item.sizeChart).toEqual(chart);
  });
  it("trusts the size chart's garment sleeve length over tags and names", () => {
    const sleeves = (cm: number) => ({ S: { garment: { sleeveCm: cm - 2 } }, M: { garment: { sleeveCm: cm } }, L: { garment: { sleeveCm: cm + 2 } } });
    const knitTee = toCatalogItem('E453754-000', { ...RAW, name: 'Souffle Yarn Polo Sweater' }, undefined, sleeves(48));
    expect('item' in knitTee && knitTee.item.shape).toBe('tee');
    const longTee = toCatalogItem(
      'E453754-000',
      { ...RAW, name: 'Soft Brushed Turtleneck T-Shirt', breadcrumbs: { class: { locale: 'T-Shirts' } } },
      undefined,
      sleeves(88),
    );
    expect('item' in longTee && longTee.item.shape).toBe('sweater');
  });
  it('drops body chest from pants size charts (waist and hips decide pants sizes)', () => {
    const chart = { L: { chestCm: 112, waistCm: 92, inseamCm: 74, body: { chestCm: [104, 112] as [number, number], waistCm: [84, 92] as [number, number] } } };
    const raw = {
      ...RAW,
      name: 'Wide Sweatpants',
      sizes: [{ name: 'L' }],
      breadcrumbs: { class: { locale: 'Bottoms' }, category: { locale: 'Sweatpants' } },
    };
    const out = toCatalogItem('E471809-000', raw, undefined, chart);
    expect('item' in out && out.item.sizeChart).toEqual({ L: { waistCm: 92, inseamCm: 74, body: { waistCm: [84, 92] } } });
  });
  it('keeps only size-chart rows the item sells, in its order', () => {
    const chart = { XXS: { chestCm: 84 }, M: { chestCm: 104 }, S: { chestCm: 96 } };
    const out = toCatalogItem('E453754-000', RAW, undefined, chart);
    expect('item' in out && out.item.sizeChart).toEqual({ S: { chestCm: 96 }, M: { chestCm: 104 } });
    expect(Object.keys(('item' in out && out.item.sizeChart) || {})).toEqual(['S', 'M']);
    const none = toCatalogItem('E453754-000', RAW, undefined, { XXS: { chestCm: 84 } });
    expect('item' in none && none.item.sizeChart).toBeNull();
  });
  it('does not trust image URLs or colour codes from pasted JSON', () => {
    const raw = {
      ...RAW,
      colors: [{ displayCode: '09', name: 'BLACK' }, { displayCode: '../x', name: 'BAD' }],
      images: { main: { '09': { image: 'javascript:alert(1)' } } },
    };
    const out = toCatalogItem('E453754-000', raw);
    expect('item' in out && out.item.colors.map((c) => c.code)).toEqual(['09']);
    expect('item' in out && out.item.image).toBeUndefined();
    expect('item' in out && out.item.colors[0].image).toBeUndefined();
  });
  it('survives malformed arrays in the payload', () => {
    const raw = { ...RAW, colors: 'oops', sizes: { name: 'M' }, tags: 'x' } as unknown as UniqloDetails;
    expect(toCatalogItem('E453754-000', raw)).toEqual({ error: 'Washable Milano Ribbed Sweater has no colourways listed.' });
  });
  it('uses the representative colour image as the main image when there is one', () => {
    const raw = {
      ...RAW,
      // '69' is an integer-like key, so Object.values() lists it first; the representative colour must win.
      representative: { color: { displayCode: '09' } },
      images: { main: { '69': { image: 'https://image.uniqlo.com/69.jpg' }, '09': { image: 'https://image.uniqlo.com/09.jpg' } } },
    };
    const out = toCatalogItem('E453754-000', raw);
    expect('item' in out && out.item.image).toBe('https://image.uniqlo.com/09.jpg');
  });
  it('rejects shorts with a clear message', () => {
    const out = toCatalogItem('E482944-000', {
      ...RAW,
      name: 'Chino Shorts | 8.5"',
      breadcrumbs: { class: { locale: 'Bottoms' }, category: { locale: 'Shorts' } },
    });
    expect(out).toEqual({ error: 'Chino Shorts | 8.5" (Shorts) is not supported yet. Try a T-shirt, sweater or pants.' });
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
