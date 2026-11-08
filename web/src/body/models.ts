import type { BuildPreset } from './builds';

export type ModelId = 'male' | 'female';
export const MODEL_IDS: ModelId[] = ['male', 'female'];
export const DEFAULT_MODEL: ModelId = 'male';

export interface ModelConfig {
  label: string;
  bodyUrl: string;
  measureUrl: string;
  /** Garments for this body only; never mix folders (CLAUDE.md). */
  garmentDir: string;
  baseHeightCm: number;
  builds: BuildPreset[];
  defaultBuild: number;
  /** The user's own glasses (male default body is styled from their photo). */
  glasses: boolean;
}

// Girth presets for the Build slider (cm). defaultBuild matches each GLB's exported body.
export const MODELS: Record<ModelId, ModelConfig> = {
  male: {
    label: 'Men',
    bodyUrl: '/models/body.glb',
    measureUrl: '/models/body_measure.json',
    garmentDir: '/garments',
    baseHeightCm: 178,
    builds: [
      { label: 'Slim', girths: { chest: 87, waist: 71, hips: 86 } },
      { label: 'Lean', girths: { chest: 92, waist: 75, hips: 90 } },
      { label: 'Regular', girths: { chest: 98, waist: 84, hips: 95 } },
      { label: 'Athletic', girths: { chest: 106, waist: 84, hips: 98 } },
      { label: 'Broad', girths: { chest: 112, waist: 98, hips: 106 } },
    ],
    defaultBuild: 1,
    glasses: true,
  },
  female: {
    label: 'Women',
    bodyUrl: '/models/body_female.glb',
    measureUrl: '/models/body_female_measure.json',
    garmentDir: '/garments/female',
    baseHeightCm: 172,
    builds: [
      { label: 'Slim', girths: { chest: 81, waist: 61, hips: 85 } },
      { label: 'Lean', girths: { chest: 86, waist: 65, hips: 89 } },
      { label: 'Regular', girths: { chest: 92, waist: 72, hips: 96 } },
      { label: 'Curvy', girths: { chest: 98, waist: 75, hips: 104 } },
      { label: 'Full', girths: { chest: 106, waist: 88, hips: 110 } },
    ],
    defaultBuild: 1,
    glasses: false,
  },
};

export function garmentUrl(model: ModelId, shape: string): string {
  return `${MODELS[model].garmentDir}/${shape}.glb`;
}

export function fitsUrl(model: ModelId): string {
  return `${MODELS[model].garmentDir}/fits.json`;
}
