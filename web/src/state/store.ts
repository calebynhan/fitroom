import { create } from 'zustand';
import { weightsForGirths, type BodyMeasure, type Girths } from '../body/measurements';
import { DEFAULT_MODEL, MODELS, type ModelId } from '../body/models';
import type { FitsFile } from '../catalog/fits';
import type { CatalogItem, Selection, Slot } from '../catalog/types';
import { DEFAULT_POSE, type PoseId } from '../viewer/poses';
import { DEFAULT_SCENE, type SceneId } from '../viewer/scenes';

export const DEFAULT_TOP_ID = 'E453754-000'; // Washable Milano Ribbed Sweater
export const DEFAULT_BOTTOM_ID = 'E475598-000'; // Ultra Stretch Pants
const DEFAULT_COLORS: Record<string, string> = { [DEFAULT_TOP_ID]: '67', [DEFAULT_BOTTOM_ID]: '09' }; // blue over black

interface FitState {
  model: ModelId;
  pose: PoseId;
  scene: SceneId;
  autoRotate: boolean;
  catalog: CatalogItem[];
  outfit: Record<Slot, Selection | null>;
  heightCm: number;
  girths: Girths;
  /** Linear girth model from the pipeline; null until the model's measure json loads. */
  measure: BodyMeasure | null;
  /** Morph weights body_0..body_n; null until the body GLB provides its defaults. */
  weights: number[] | null;
  fits: FitsFile | null;

  setModel: (model: ModelId) => void;
  setPose: (pose: PoseId) => void;
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

/** Body state that resets whenever the model (and so the GLB set) changes. */
function bodyDefaults(model: ModelId) {
  const config = MODELS[model];
  return {
    model,
    heightCm: config.baseHeightCm,
    girths: { ...config.builds[config.defaultBuild].girths },
    measure: null,
    weights: null,
    fits: null,
  };
}

export const useFit = create<FitState>()((set) => ({
  ...bodyDefaults(DEFAULT_MODEL),
  pose: DEFAULT_POSE,
  scene: DEFAULT_SCENE,
  autoRotate: true,
  catalog: [],
  outfit: { top: null, bottom: null },

  setModel: (model) => set((s) => (s.model === model ? {} : bodyDefaults(model))),
  setPose: (pose) => set({ pose }),
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
