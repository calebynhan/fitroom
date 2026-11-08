import type { Girths } from '../body/measurements';
import type { Selection, Slot } from '../catalog/types';

export interface LookInput {
  model: string;
  outfit: Record<Slot, Selection | null>;
  scene: string;
  pose: string;
  heightCm: number;
  girths: Girths;
}

const slotKey = (sel: Selection | null) => (sel ? `${sel.itemId}:${sel.colorCode}` : '-');

/** Everything a photograph depicts. A different key means the photo no longer matches the 3D view. */
export function lookKey(s: LookInput): string {
  const { chest, waist, hips } = s.girths;
  return [
    s.model,
    slotKey(s.outfit.top),
    slotKey(s.outfit.bottom),
    s.scene,
    s.pose,
    Math.round(s.heightCm),
    Math.round(chest),
    Math.round(waist),
    Math.round(hips),
  ].join('|');
}
