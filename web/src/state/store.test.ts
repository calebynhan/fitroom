import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { useApp, validSelection } from './store';

const item = (id: string, slot: 'top' | 'bottom', sizes: string[]): CatalogItem =>
  ({ id, name: id, slot, sizes, colors: [{ code: '09', name: 'Black' }, { code: '67', name: 'Blue' }] }) as unknown as CatalogItem;
const catalog = [item('E453754-000', 'top', ['S', 'M']), item('E475598-000', 'bottom', ['S', 'M'])];

describe('validSelection', () => {
  it('keeps a valid pick', () => {
    expect(validSelection(catalog, { itemId: 'E453754-000', colorCode: '67', size: 'M' }, 'top')).toEqual({ itemId: 'E453754-000', colorCode: '67', size: 'M' });
  });
  it('repairs what the item no longer has and refuses the wrong slot', () => {
    expect(validSelection(catalog, { itemId: 'E453754-000', colorCode: '99', size: 'XXL' }, 'top')).toEqual({ itemId: 'E453754-000', colorCode: '09' });
    expect(validSelection(catalog, { itemId: 'E453754-000', colorCode: '67' }, 'bottom')).toBeNull();
    expect(validSelection(catalog, { itemId: 'E000000-000', colorCode: '67' }, 'top')).toBeNull();
    expect(validSelection(catalog, 'junk', 'top')).toBeNull();
  });
});

describe('applyOutfit', () => {
  it('wears what it can and leaves the rest', () => {
    useApp.getState().setCatalog(catalog);
    const before = useApp.getState().outfit.bottom;
    const applied = useApp.getState().applyOutfit(
      { top: { itemId: 'E453754-000', colorCode: '09', size: 'M' }, bottom: { itemId: 'E000000-000', colorCode: '09' } },
      'night',
    );
    expect(applied).toEqual(['top']);
    expect(useApp.getState().outfit.top).toEqual({ itemId: 'E453754-000', colorCode: '09', size: 'M' });
    expect(useApp.getState().outfit.bottom).toEqual(before);
    expect(useApp.getState().scene).toBe('night');
  });
});
