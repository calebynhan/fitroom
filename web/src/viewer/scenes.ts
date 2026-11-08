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
  /** Project the photo's own floor under the avatar (sharp, real location) instead of a plain disc. */
  groundProjection: { height: number; radius: number } | null;
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
    groundProjection: null,
    chromeDark: false,
    setting: 'a bright, minimal photo studio with a seamless light-grey backdrop and soft even lighting',
  },
  city: {
    label: 'City',
    hdri: '/hdri/potsdamer_platz_4k.hdr', // Potsdamer Platz, Berlin (Poly Haven, CC0)
    showBackground: true,
    backgroundColor: '#9aa3ad',
    backgroundBlurriness: 0,
    backgroundIntensity: 0.9,
    environmentIntensity: 0.9,
    keyLight: 1.2,
    keyColor: '#fff4e6',
    rimLight: 0.5,
    rimColor: '#cfe0ff',
    shadowOpacity: 0.45,
    groundColor: '#8d8c88', // pavement
    groundRoughness: 0.95,
    groundProjection: { height: 1.7, radius: 40 },
    chromeDark: true, // light text with a shadow reads over the photo
    setting: 'Potsdamer Platz in Berlin in daylight, modern buildings and a wide plaza behind',
  },
  night: {
    label: 'Night',
    hdri: '/hdri/shanghai_bund_4k.hdr', // The Bund, Shanghai at night (Poly Haven, CC0)
    showBackground: true,
    backgroundColor: '#0d1220',
    backgroundBlurriness: 0,
    backgroundIntensity: 0.32,
    environmentIntensity: 1.15,
    keyLight: 1.5,
    keyColor: '#ffd9b0',
    rimLight: 2.0,
    rimColor: '#7fa6ff',
    shadowOpacity: 0.45,
    groundColor: '#1d2027', // dark wet asphalt
    groundRoughness: 0.45,
    groundProjection: { height: 1.7, radius: 40 },
    chromeDark: true,
    setting: 'the Shanghai Bund waterfront at night, neon skyline behind, warm key light and a cool rim light',
  },
};
