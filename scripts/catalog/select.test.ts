import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../../api/_lib/uniqlo.ts';
import { mapLimit, pickCandidates, selectGroup, validateCatalogItem } from './select.ts';

const listing = (productId: string, name: string, count = 0, sizeGender = 'MEN') => ({
  productId,
  name,
  sizeGender,
  rating: { average: 4.5, count },
});

function item(id: string, name: string, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    name,
    price: 19.9,
    salePrice: null,
    slot: 'top',
    shape: 'tee',
    fabric: 'jersey',
    fit: 'regular',
    url: "https://www.uniqlo.com/us/en/products/E455365-000/00",
    image: 'https://image.uniqlo.com/x.jpg',
    colors: [{ code: '09', name: 'Black', hex: '#111111', swatch: 'https://image.uniqlo.com/chip.jpg' }],
    sizes: ['S', 'M'],
    sizeChart: null,
    ...overrides,
  };
}

describe('pickCandidates', () => {
  it('dedupes price-group duplicates, ranks by review count and caps the list', () => {
    const out = pickCandidates(
      [
        listing('E1', 'Crew Neck T-Shirt', 10),
        listing('E2', 'SUPIMA Cotton T-Shirt', 50),
        listing('E1', 'Crew Neck T-Shirt', 10),
        listing('E3', 'Waffle T-Shirt', 5),
      ],
      { heroes: [], limit: 2 },
    );
    expect(out).toEqual(['E2', 'E1']);
  });

  it('drops things the 3D view cannot show honestly or that duplicate others', () => {
    const names = [
      'Straight Jeans | Tall',
      'AIRism Cotton Striped T-Shirt',
      'DRY-EX T-Shirt | Patterned',
      'DRY-EX T-Shirt | Color Block',
      'Bicolor T-Shirt',
      'Smart Pants | Glen Check',
      'HEATTECH T-Shirt',
      'DRY-EX Polo Shirt',
      'Souffle Yarn Cardigan',
      'Chino Shorts | 8.5"',
      'HEATTECH Tights',
      'DRY Color Ribbed Tank Top',
      'Knitted Vest',
    ];
    const out = pickCandidates(
      names.map((n, i) => listing(`E${i}`, n, 100)),
      { heroes: [], limit: 50 },
    );
    expect(out).toEqual([]);
  });

  it("keeps men's sizing only, except hero items", () => {
    const out = pickCandidates(
      [listing('E1', 'Barrel Jeans', 500, 'WOMEN'), listing('E2', 'Straight Jeans', 1, 'MEN'), listing('E3', 'Wide Jeans', 9, 'WOMEN')],
      { heroes: ['E1'], limit: 10 },
    );
    expect(out).toEqual(['E1', 'E2']);
  });

  it('always includes heroes first, even past the limit or missing from the listing', () => {
    const out = pickCandidates([listing('E1', 'Crew Neck T-Shirt', 10), listing('E2', 'Waffle T-Shirt', 99)], {
      heroes: ['E9', 'E1'],
      limit: 1,
    });
    expect(out).toEqual(['E9', 'E1', 'E2']);
  });

  it('ignores listing rows without a product ID', () => {
    expect(pickCandidates([{ name: 'x' }, listing('E1', 'Tee')], { heroes: [], limit: 5 })).toEqual(['E1']);
  });
});

describe('selectGroup', () => {
  it('keeps heroes first, then the given order, up to the target', () => {
    const items = [item('E1', 'A'), item('E2', 'B'), item('E3', 'C'), item('H1', 'Hero')];
    expect(selectGroup(items, { heroes: ['H1'], target: 3 }).map((i) => i.id)).toEqual(['H1', 'E1', 'E2']);
  });

  it('drops same-name duplicates (e.g. two SUPIMA T-shirt versions), preferring the hero', () => {
    const items = [item('E2', 'SUPIMA Cotton T-Shirt'), item('E1', 'Crew Neck T-Shirt'), item('H1', 'SUPIMA  cotton t-shirt')];
    expect(selectGroup(items, { heroes: ['H1'], target: 5 }).map((i) => i.id)).toEqual(['H1', 'E1']);
  });

  it('keeps every hero even when there are more heroes than the target', () => {
    const items = [item('H1', 'A'), item('H2', 'B'), item('E1', 'C')];
    expect(selectGroup(items, { heroes: ['H1', 'H2'], target: 1 }).map((i) => i.id)).toEqual(['H1', 'H2']);
  });
});

describe('validateCatalogItem', () => {
  it('accepts a contract-shaped item', () => {
    expect(validateCatalogItem(item('E1', 'Tee'))).toEqual([]);
  });

  it('lists every problem', () => {
    const bad = item('E1', '', {
      price: Number.NaN,
      salePrice: 30,
      fit: 'tight' as CatalogItem['fit'],
      url: 'https://evil.example/x',
      colors: [{ code: '09', name: 'Black', hex: 'black', swatch: 'https://image.uniqlo.com/chip.jpg' }],
      sizes: [],
      sizeChart: { M: { chestCm: -5 } },
    });
    expect(validateCatalogItem(bad)).toEqual([
      'name is empty',
      'price is not a positive number',
      'salePrice is not below price',
      'fit is not slim|regular|relaxed',
      'url is not a uniqlo.com product page',
      'colour 09 hex is not #rrggbb',
      'sizes is empty',
      'sizeChart M.chestCm is not a positive number',
    ]);
  });

  it('checks slot matches shape', () => {
    expect(validateCatalogItem(item('E1', 'Tee', { shape: 'pants', slot: 'top' }))).toEqual(['slot does not match shape']);
  });

  it('flags size-chart sizes the item does not sell', () => {
    expect(validateCatalogItem(item('E1', 'Tee', { sizeChart: { XL: { chestCm: 120 } } }))).toEqual([
      'sizeChart has sizes not in sizes: XL',
    ]);
  });
});

describe('mapLimit', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running -= 1;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });
});
