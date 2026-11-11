import { afterEach, describe, expect, it, vi } from 'vitest';
import { notCoveredMessage, resolveProduct } from './catalog';

vi.mock('../productLookup', () => ({
  getProduct: async (id: string) =>
    id === 'E999999-000'
      ? { ok: false, status: 422, body: { error: 'Pocketable Parka (Jackets) is not supported yet. Try a T-shirt, sweater or pants.', code: 'unsupported' } }
      : { ok: false, status: 404, body: { error: `No UNIQLO product ${id}.`, code: 'not_found' } },
}));

afterEach(() => vi.restoreAllMocks());

describe('what FitRoom does not cover', () => {
  it('flags outerwear, button-ups, shorts and women\'s or kids\' items, not T-shirts or plain "shirts"', () => {
    for (const t of ['puffer jacket', 'oxford shirt', 'flannel', 'button-down', 'swim shorts', 'hoodie', 'down vest']) expect(notCoveredMessage(t), t).not.toBeNull();
    expect(notCoveredMessage("women's jeans")).toContain("women's and kids'");
    expect(notCoveredMessage('kids tee')).toContain("women's and kids'");
    for (const t of ['crew neck t-shirt', 'black shirts', 'sweatshirt', 'chinos', 'milano sweater']) expect(notCoveredMessage(t), t).toBeNull();
  });

  it('adds "don\'t guess" to an unsupported product link, keeping the lookup\'s own words', async () => {
    const r = await resolveProduct('https://www.uniqlo.com/us/en/products/E999999-000/00');
    expect(r).toMatchObject({ ok: false, notCovered: true });
    expect(!r.ok && r.message).toBe(
      "Pocketable Parka (Jackets) is not supported yet. Try a T-shirt, sweater or pants. FitRoom sizes UNIQLO men's T-shirts, sweaters, sweatshirts and pants (jeans, chinos, trousers); don't guess a size.",
    );
  });
});
