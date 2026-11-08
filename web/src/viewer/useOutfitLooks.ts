import { useMemo } from 'react';
import { fitFor, type FitMorphs } from '../catalog/fits';
import { findColor, type Shape, type Slot } from '../catalog/types';
import { useFit } from '../state/store';

export interface WornLook {
  slot: Slot;
  shape: Shape;
  fabric: string;
  hex: string;
  fitMorphs: FitMorphs;
}

/** Resolves the current outfit selections into what the viewer needs to draw. */
export function useOutfitLooks(): Record<Slot, WornLook | null> {
  const outfit = useFit((s) => s.outfit);
  const catalog = useFit((s) => s.catalog);
  const fits = useFit((s) => s.fits);
  return useMemo(() => {
    const resolve = (slot: Slot): WornLook | null => {
      const sel = outfit[slot];
      const item = sel && catalog.find((i) => i.id === sel.itemId);
      if (!sel || !item) return null;
      const fitMorphs = fitFor(fits, item.id, item.name).morphs;
      return { slot, shape: item.shape, fabric: item.fabric, hex: findColor(item, sel.colorCode).hex, fitMorphs };
    };
    return { top: resolve('top'), bottom: resolve('bottom') };
  }, [outfit, catalog, fits]);
}
