// Saved outfits: a short list in this browser (localStorage), like the measurements. Never photos.
import { create } from 'zustand';
import { safeStorage } from '../body/profile';
import type { Selection, Slot } from '../catalog/types';
import type { SceneId } from '../look/scenes';
import { decodeSelection } from './share';

const KEY = 'fitroom.saved.v1';
export const MAX_SAVED = 20;

export interface SavedOutfit {
  id: string;
  /** "Washable Milano Ribbed Sweater + Ultra Stretch Pants", fixed at save time (items can leave the catalog). */
  name: string;
  outfit: Partial<Record<Slot, Selection>>;
  scene: SceneId;
  savedAt: number;
}

const SCENES: readonly string[] = ['studio', 'city', 'night'];

/** Drops anything malformed (storage is shared with whatever ran on this origin before). */
export function parseSaved(raw: unknown): SavedOutfit[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedOutfit[] = [];
  for (const r of raw.slice(0, MAX_SAVED)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const outfit = (o.outfit ?? {}) as Record<string, unknown>;
    const pick = (slot: Slot) => {
      const s = outfit[slot] as Partial<Selection> | undefined;
      return s ? decodeSelection([s.itemId, s.colorCode, s.size].filter(Boolean).join('.')) : null;
    };
    const top = pick('top');
    const bottom = pick('bottom');
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || (!top && !bottom)) continue;
    out.push({
      id: o.id,
      name: o.name.slice(0, 120),
      outfit: { ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) },
      scene: SCENES.includes(o.scene as string) ? (o.scene as SceneId) : 'studio',
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
    });
  }
  return out;
}

function load(): SavedOutfit[] {
  try {
    const raw = safeStorage()?.getItem(KEY);
    return raw ? parseSaved(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

const sameOutfit = (a: SavedOutfit['outfit'], b: SavedOutfit['outfit']) =>
  (['top', 'bottom'] as const).every((s) => a[s]?.itemId === b[s]?.itemId && a[s]?.colorCode === b[s]?.colorCode && a[s]?.size === b[s]?.size);

interface SavedStore {
  saved: SavedOutfit[];
  /** Saves (newest first); saving the same outfit again moves it to the top instead of duplicating it. */
  save: (entry: Omit<SavedOutfit, 'id' | 'savedAt'>) => void;
  remove: (id: string) => void;
}

export const useSaved = create<SavedStore>()((set) => ({
  saved: load(),
  save: (entry) =>
    set((s) => {
      const rest = s.saved.filter((x) => !sameOutfit(x.outfit, entry.outfit));
      const item: SavedOutfit = { ...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: Date.now() };
      return { saved: [item, ...rest].slice(0, MAX_SAVED) };
    }),
  remove: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
}));

useSaved.subscribe((s, prev) => {
  if (s.saved === prev.saved) return;
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(s.saved));
  } catch {
    // storage full or blocked: the list lasts until reload
  }
});
