import type { Girths } from './measurements';

export interface BuildPreset {
  label: string;
  girths: Girths;
}

export function buildLabel(builds: BuildPreset[], girths: Girths): string {
  const match = builds.find((b) => b.girths.chest === girths.chest && b.girths.waist === girths.waist && b.girths.hips === girths.hips);
  return match?.label ?? 'Custom';
}

export interface SliderRange {
  min: number;
  max: number;
}

export const HEIGHT_RANGE: SliderRange = { min: 145, max: 205 };
export const GIRTH_RANGES: Record<keyof Girths, SliderRange> = {
  chest: { min: 72, max: 125 },
  waist: { min: 55, max: 115 },
  hips: { min: 75, max: 125 },
};
