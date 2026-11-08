export type SceneId = 'studio' | 'city' | 'night';

export interface ScenePreset {
  label: string;
  hdri: string; // self-hosted copies of drei's preset HDRIs (Poly Haven, CC0)
  showBackground: boolean;
  backgroundColor: string;
  backgroundBlurriness: number;
  backgroundIntensity: number;
  environmentIntensity: number;
  keyLight: number;
  keyColor: string;
  rimLight: number;
  rimColor: string;
  shadowOpacity: number;
  groundColor: string;
  groundRoughness: number;
  /** Viewer labels switch to light text over dark backdrops. */
  chromeDark: boolean;
  /** Words for the photoreal prompt. */
  setting: string;
}

export const SCENE_IDS: SceneId[] = ['studio', 'city', 'night'];
export const DEFAULT_SCENE: SceneId = 'studio';

export const SCENES: Record<SceneId, ScenePreset> = {
  studio: {
    label: 'Studio',
    hdri: '/hdri/studio_small_03_1k.hdr',
    showBackground: false,
    backgroundColor: '#f7f6f2',
    backgroundBlurriness: 0,
    backgroundIntensity: 1,
    environmentIntensity: 0.65,
    keyLight: 1.05,
    keyColor: '#ffffff',
    rimLight: 0.5,
    rimColor: '#ffffff',
    shadowOpacity: 0.45,
    groundColor: '#ebe8e1', // seamless studio floor
    groundRoughness: 1,
    chromeDark: false,
    setting: 'a bright, minimal photo studio with a seamless light-grey backdrop and soft even lighting',
  },
  city: {
    label: 'City',
    hdri: '/hdri/potsdamer_platz_1k.hdr',
    showBackground: true,
    backgroundColor: '#9aa3ad',
    backgroundBlurriness: 0.12,
    backgroundIntensity: 0.9,
    environmentIntensity: 0.9,
    keyLight: 1.2,
    keyColor: '#fff4e6',
    rimLight: 0.5,
    rimColor: '#cfe0ff',
    shadowOpacity: 0.45,
    groundColor: '#8d8c88', // pavement
    groundRoughness: 0.95,
    chromeDark: false, // light sky behind the labels
    setting: 'a city street in daylight, shallow depth of field with softly blurred buildings behind',
  },
  night: {
    label: 'Night',
    hdri: '/hdri/dikhololo_night_1k.hdr',
    showBackground: true,
    backgroundColor: '#0d1220',
    backgroundBlurriness: 0.25,
    backgroundIntensity: 0.32,
    environmentIntensity: 1.15,
    keyLight: 1.5,
    keyColor: '#ffd9b0',
    rimLight: 2.0,
    rimColor: '#7fa6ff',
    shadowOpacity: 0.45,
    groundColor: '#1d2027', // dark wet asphalt
    groundRoughness: 0.45,
    chromeDark: true,
    setting: 'outdoors at night under a starry sky, warm key light and a cool blue rim light',
  },
};
