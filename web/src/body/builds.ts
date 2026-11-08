import type { Girths } from './measurements';

export interface BuildPreset {
  label: string;
  girths: Girths;
}

// Girth presets for the Build slider (cm, at ~178 cm). Index 1 is Caleb's default body.
export const BUILDS: BuildPreset[] = [
  { label: 'Slim', girths: { chest: 87, waist: 71, hips: 86 } },
  { label: 'Lean', girths: { chest: 92, waist: 75, hips: 90 } },
  { label: 'Regular', girths: { chest: 98, waist: 84, hips: 95 } },
  { label: 'Athletic', girths: { chest: 106, waist: 84, hips: 98 } },
  { label: 'Broad', girths: { chest: 112, waist: 98, hips: 106 } },
];
export const DEFAULT_BUILD = 1;

export function buildLabel(girths: Girths): string {
  const match = BUILDS.find((b) => b.girths.chest === girths.chest && b.girths.waist === girths.waist && b.girths.hips === girths.hips);
  return match?.label ?? 'Custom';
}

export interface SliderRange {
  min: number;
  max: number;
}

export const HEIGHT_RANGE: SliderRange = { min: 150, max: 205 };
export const GIRTH_RANGES: Record<keyof Girths, SliderRange> = {
  chest: { min: 75, max: 125 },
  waist: { min: 60, max: 115 },
  hips: { min: 75, max: 125 },
};
