import { create } from 'zustand';
import { loadProfile, safeStorage, saveProfile, type Profile } from '../body/profile';
import type { CatalogItem, Selection, Slot } from '../catalog/types';
import { DEFAULT_SCENE, SCENE_IDS, type SceneId } from '../look/scenes';
import type { PhotoSlot, PreparedPhoto } from '../photos/prepare';

export const DEFAULT_TOP_ID = 'E453754-000'; // Washable Milano Ribbed Sweater
export const DEFAULT_BOTTOM_ID = 'E475598-000'; // Ultra Stretch Pants
const DEFAULT_COLORS: Record<string, string> = { [DEFAULT_TOP_ID]: '67', [DEFAULT_BOTTOM_ID]: '09' }; // blue over black
const OUTFIT_KEY = 'fitroom.outfit.v1';

type Outfit = Record<Slot, Selection | null>;

interface AppState {
  catalog: CatalogItem[];
  outfit: Outfit;
  scene: SceneId;
  profile: Profile;
  /** In memory only (never persisted). */
  photos: Record<PhotoSlot, PreparedPhoto | null>;
  /** Bumps on every photo change, so a new photo means a new look. */
  photoVersion: number;

  setCatalog: (items: CatalogItem[]) => void;
  addItem: (item: CatalogItem) => void;
  wear: (item: CatalogItem, colorCode?: string) => void;
  setColor: (slot: Slot, colorCode: string) => void;
  setSize: (slot: Slot, size: string | undefined) => void;
  setScene: (scene: SceneId) => void;
  /** Wears a saved or shared outfit (slots it leaves out stay as they are). Returns the slots it could apply. */
  applyOutfit: (outfit: Partial<Record<Slot, Selection>>, scene?: SceneId) => Slot[];
  setProfile: (patch: Partial<Profile>) => void;
  setPhoto: (slot: PhotoSlot, photo: PreparedPhoto | null) => void;
}

interface Saved {
  outfit?: Partial<Outfit>;
  scene?: unknown;
}

function loadSaved(): Saved {
  try {
    const raw = safeStorage()?.getItem(OUTFIT_KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function isSelection(v: unknown): v is Selection {
  const s = v as Partial<Selection> | null;
  return !!s && typeof s.itemId === 'string' && typeof s.colorCode === 'string' && (s.size === undefined || typeof s.size === 'string');
}

/** `selection` checked against the catalog: null if the item is gone or in the other slot; an unknown colour becomes
 * the item's first, an unknown size is dropped (the shopper's own size is picked instead). */
export function validSelection(items: CatalogItem[], selection: unknown, slot: Slot): Selection | null {
  if (!isSelection(selection)) return null;
  const item = items.find((i) => i.id === selection.itemId && i.slot === slot);
  if (!item || item.colors.length === 0) return null;
  const colorCode = item.colors.some((c) => c.code === selection.colorCode) ? selection.colorCode : item.colors[0].code;
  const sizeOk = selection.size !== undefined && Array.isArray(item.sizes) && item.sizes.includes(selection.size);
  return { itemId: item.id, colorCode, ...(sizeOk ? { size: selection.size } : {}) };
}

/** A saved selection still valid against the catalog (same colour), else the default item for the slot. */
function resolveSelection(items: CatalogItem[], saved: unknown, id: string, slot: Slot): Selection | null {
  const valid = validSelection(items, saved, slot);
  if (valid && isSelection(saved) && valid.colorCode === saved.colorCode) return valid;
  const item = items.find((i) => i.id === id) ?? items.find((i) => i.slot === slot);
  if (!item) return null;
  const preferred = item.colors.find((c) => c.code === DEFAULT_COLORS[item.id]);
  return { itemId: item.id, colorCode: (preferred ?? item.colors[0]).code };
}

const saved = loadSaved();

export const useApp = create<AppState>()((set, get) => ({
  catalog: [],
  outfit: { top: null, bottom: null },
  scene: SCENE_IDS.includes(saved.scene as SceneId) ? (saved.scene as SceneId) : DEFAULT_SCENE,
  profile: loadProfile(),
  photos: { front: null, side: null, face: null },
  photoVersion: 0,

  setCatalog: (items) =>
    set((s) => ({
      catalog: items,
      outfit: {
        top: s.outfit.top ?? resolveSelection(items, saved.outfit?.top, DEFAULT_TOP_ID, 'top'),
        bottom: s.outfit.bottom ?? resolveSelection(items, saved.outfit?.bottom, DEFAULT_BOTTOM_ID, 'bottom'),
      },
    })),
  addItem: (item) => set((s) => ({ catalog: [item, ...s.catalog.filter((i) => i.id !== item.id)] })),
  wear: (item, colorCode) =>
    set((s) => ({ outfit: { ...s.outfit, [item.slot]: { itemId: item.id, colorCode: colorCode ?? item.colors[0].code } } })),
  setColor: (slot, colorCode) =>
    set((s) => {
      const current = s.outfit[slot];
      return current ? { outfit: { ...s.outfit, [slot]: { ...current, colorCode } } } : {};
    }),
  setSize: (slot, size) =>
    set((s) => {
      const current = s.outfit[slot];
      return current ? { outfit: { ...s.outfit, [slot]: { ...current, size } } } : {};
    }),
  setScene: (scene) => set({ scene }),
  applyOutfit: (outfit, scene) => {
    const { catalog } = get();
    const next = { ...get().outfit };
    const applied: Slot[] = [];
    for (const slot of ['top', 'bottom'] as const) {
      const valid = outfit[slot] ? validSelection(catalog, outfit[slot], slot) : null;
      if (valid) {
        next[slot] = valid;
        applied.push(slot);
      }
    }
    set({ outfit: next, ...(scene && SCENE_IDS.includes(scene) ? { scene } : {}) });
    return applied;
  },
  setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
  setPhoto: (slot, photo) => set((s) => ({ photos: { ...s.photos, [slot]: photo }, photoVersion: s.photoVersion + 1 })),
}));

// Measurements, outfit and setting survive a reload; photos deliberately do not.
useApp.subscribe((s, prev) => {
  if (s.profile !== prev.profile) saveProfile(s.profile);
  if (s.outfit !== prev.outfit || s.scene !== prev.scene) {
    try {
      safeStorage()?.setItem(OUTFIT_KEY, JSON.stringify({ outfit: s.outfit, scene: s.scene }));
    } catch {
      // storage unavailable: nothing to persist to
    }
  }
});
