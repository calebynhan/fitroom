import { create } from 'zustand';
import { BASE_HEIGHT_CM, setWeight as setWeightAt } from '../body/measurements';
import type { CatalogItem, Selection, Slot } from '../catalog/types';
import { DEFAULT_SCENE, type SceneId } from '../viewer/scenes';

export const DEFAULT_TOP_ID = 'E453754-000'; // Washable Milano Ribbed Sweater
export const DEFAULT_BOTTOM_ID = 'E475598-000'; // Ultra Stretch Pants

interface FitState {
  scene: SceneId;
  autoRotate: boolean;
  catalog: CatalogItem[];
  outfit: Record<Slot, Selection | null>;
  heightCm: number;
  /** Morph weights body_0..body_n; null until body.glb provides its defaults. */
  weights: number[] | null;

  setScene: (scene: SceneId) => void;
  setAutoRotate: (on: boolean) => void;
  setCatalog: (items: CatalogItem[]) => void;
  addItem: (item: CatalogItem) => void;
  wear: (item: CatalogItem, colorCode?: string) => void;
  setColor: (slot: Slot, colorCode: string) => void;
  takeOff: (slot: Slot) => void;
  setHeight: (cm: number) => void;
  initWeights: (weights: number[]) => void;
  setWeights: (weights: number[]) => void;
  setWeight: (index: number, value: number) => void;
}

function defaultSelection(items: CatalogItem[], id: string, slot: Slot): Selection | null {
  const item = items.find((i) => i.id === id) ?? items.find((i) => i.slot === slot);
  return item ? { itemId: item.id, colorCode: item.colors[0].code } : null;
}

export const useFit = create<FitState>()((set) => ({
  scene: DEFAULT_SCENE,
  autoRotate: true,
  catalog: [],
  outfit: { top: null, bottom: null },
  heightCm: BASE_HEIGHT_CM,
  weights: null,

  setScene: (scene) => set({ scene }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setCatalog: (items) =>
    set((s) => ({
      catalog: items,
      outfit: {
        top: s.outfit.top ?? defaultSelection(items, DEFAULT_TOP_ID, 'top'),
        bottom: s.outfit.bottom ?? defaultSelection(items, DEFAULT_BOTTOM_ID, 'bottom'),
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
  takeOff: (slot) => set((s) => ({ outfit: { ...s.outfit, [slot]: null } })),
  setHeight: (heightCm) => set({ heightCm }),
  initWeights: (weights) => set((s) => (s.weights ? {} : { weights: [...weights] })),
  setWeights: (weights) => set({ weights: [...weights] }),
  setWeight: (index, value) => set((s) => (s.weights ? { weights: setWeightAt(s.weights, index, value) } : {})),
}));
