import { create } from 'zustand';
import { BUILDS, DEFAULT_BUILD } from '../body/builds';
import { BASE_HEIGHT_CM, weightsForGirths, type BodyMeasure, type Girths } from '../body/measurements';
import type { FitsFile } from '../catalog/fits';
import type { CatalogItem, Selection, Slot } from '../catalog/types';
import { DEFAULT_SCENE, type SceneId } from '../viewer/scenes';

export const DEFAULT_TOP_ID = 'E453754-000'; // Washable Milano Ribbed Sweater
export const DEFAULT_BOTTOM_ID = 'E475598-000'; // Ultra Stretch Pants
const DEFAULT_COLORS: Record<string, string> = { [DEFAULT_TOP_ID]: '67', [DEFAULT_BOTTOM_ID]: '09' }; // blue over black

interface FitState {
  scene: SceneId;
  autoRotate: boolean;
  catalog: CatalogItem[];
  outfit: Record<Slot, Selection | null>;
  heightCm: number;
  girths: Girths;
  /** Linear girth model from the pipeline; null until body_measure.json loads. */
  measure: BodyMeasure | null;
  /** Morph weights body_0..body_n; null until body.glb provides its defaults. */
  weights: number[] | null;
  fits: FitsFile | null;

  setScene: (scene: SceneId) => void;
  setAutoRotate: (on: boolean) => void;
  setCatalog: (items: CatalogItem[]) => void;
  addItem: (item: CatalogItem) => void;
  wear: (item: CatalogItem, colorCode?: string) => void;
  setColor: (slot: Slot, colorCode: string) => void;
  setHeight: (cm: number) => void;
  setGirths: (girths: Girths) => void;
  setMeasure: (measure: BodyMeasure | null) => void;
  initWeights: (weights: number[]) => void;
  setFits: (fits: FitsFile | null) => void;
}

function defaultSelection(items: CatalogItem[], id: string, slot: Slot): Selection | null {
  const item = items.find((i) => i.id === id) ?? items.find((i) => i.slot === slot);
  if (!item) return null;
  const preferred = item.colors.find((c) => c.code === DEFAULT_COLORS[item.id]);
  return { itemId: item.id, colorCode: (preferred ?? item.colors[0]).code };
}

export const useFit = create<FitState>()((set) => ({
  scene: DEFAULT_SCENE,
  autoRotate: true,
  catalog: [],
  outfit: { top: null, bottom: null },
  heightCm: BASE_HEIGHT_CM,
  girths: { ...BUILDS[DEFAULT_BUILD].girths },
  measure: null,
  weights: null,
  fits: null,

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
  setHeight: (heightCm) => set({ heightCm }),
  setGirths: (girths) =>
    set((s) => ({ girths: { ...girths }, weights: s.measure && s.weights ? weightsForGirths(s.measure, girths) : s.weights })),
  setMeasure: (measure) =>
    set((s) => ({ measure, weights: measure && s.weights ? weightsForGirths(measure, s.girths) : s.weights })),
  initWeights: (weights) =>
    set((s) => {
      if (s.weights) return {};
      return { weights: s.measure ? weightsForGirths(s.measure, s.girths) : [...weights] };
    }),
  setFits: (fits) => set({ fits }),
}));
