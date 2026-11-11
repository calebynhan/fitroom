// Wears a saved or shared outfit. Items outside the bundled catalog (pasted links) are fetched from UNIQLO first, the
// same way a pasted link is. A notice says what loaded and what didn't.
import { productPageUrl } from '@api/uniqlo';
import { create } from 'zustand';
import { fetchProduct } from '../catalog/fetchProduct';
import type { Slot } from '../catalog/types';
import { useApp } from '../state/store';
import { parseOutfitQuery, type SharedOutfit } from './share';

export interface OutfitNotice {
  kind: 'ok' | 'error';
  text: string;
}

export const useOutfitNotice = create<{ notice: OutfitNotice | null }>()(() => ({ notice: null }));
export const setOutfitNotice = (notice: OutfitNotice | null) => useOutfitNotice.setState({ notice });

const SLOT_WORD: Record<Slot, string> = { top: 'top', bottom: 'pants' };

/** Wears `o`; resolves to the slots it applied. */
export async function loadOutfit(o: SharedOutfit, source: 'link' | 'saved'): Promise<Slot[]> {
  const app = useApp.getState();
  const slots = (['top', 'bottom'] as const).filter((s) => o.outfit[s]);
  const unknown = slots.map((s) => o.outfit[s]!.itemId).filter((id) => !app.catalog.some((i) => i.id === id));
  const failures: string[] = [];
  await Promise.all(
    [...new Set(unknown)].map(async (id) => {
      const result = await fetchProduct(productPageUrl(id));
      if ('id' in result) useApp.getState().addItem(result);
      else failures.push(result.error);
    }),
  );
  const applied = useApp.getState().applyOutfit(o.outfit, o.scene);
  const missed = slots.filter((s) => !applied.includes(s));
  const names = applied.map((s) => {
    const sel = useApp.getState().outfit[s]!;
    return useApp.getState().catalog.find((i) => i.id === sel.itemId)?.name ?? SLOT_WORD[s];
  });
  if (missed.length === 0) {
    const what = source === 'link' ? 'Outfit from a shared link' : 'Wearing your saved outfit';
    setOutfitNotice({ kind: 'ok', text: `${what}: ${names.join(' + ')}.` });
  } else {
    const why = failures[0] ? ` (${failures[0].replace(/\.$/, '')})` : '';
    const lost = missed.map((s) => `the ${SLOT_WORD[s]}`).join(' and ');
    const kept = applied.length ? ` Loaded ${names.join(' + ')}.` : '';
    setOutfitNotice({ kind: 'error', text: `Couldn't load ${lost} from this ${source === 'link' ? 'link' : 'outfit'}${why}; UNIQLO may have stopped selling it.${kept}` });
  }
  return applied;
}

let handled = false;

/** Once, after the catalog is in: wears the outfit in the page's URL and tidies the URL (a reload keeps the outfit). */
export async function loadOutfitFromUrl(): Promise<void> {
  if (handled || typeof window === 'undefined') return;
  handled = true;
  const shared = parseOutfitQuery(window.location.search);
  if (!shared) return;
  const url = new URL(window.location.href);
  for (const key of ['top', 'bottom', 'scene']) url.searchParams.delete(key);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  await loadOutfit(shared, 'link');
}
