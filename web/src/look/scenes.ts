import type { Scene } from '@api/look';

export type SceneId = Scene;
export const SCENE_IDS: SceneId[] = ['studio', 'city', 'night'];
export const DEFAULT_SCENE: SceneId = 'studio';

export const SCENES: Record<SceneId, { label: string; hint: string; tile: { bg: string; fg: string } }> = {
  studio: { label: 'Studio', hint: 'Product page', tile: { bg: '#F4F1EC', fg: '#6F6A63' } },
  city: { label: 'City', hint: 'Street, daylight', tile: { bg: 'repeating-linear-gradient(135deg,#E4DFD6 0 5px,#D6D1C8 5px 10px)', fg: '#3A3835' } },
  night: { label: 'Night', hint: 'Street, after dark', tile: { bg: 'repeating-linear-gradient(135deg,#1c1c1c 0 5px,#2a2a2a 5px 10px)', fg: '#E4DFD6' } },
};
