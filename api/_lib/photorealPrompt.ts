export type PhotorealScene = 'studio' | 'city' | 'night';

export const SCENE_SETTINGS: Record<PhotorealScene, string> = {
  studio: 'a bright, minimal photo studio with a seamless light-grey backdrop and soft, even lighting',
  city: 'a city street in daylight, shallow depth of field with softly blurred buildings behind',
  night: 'a city street at night, warm key light from street lamps and a cool blue rim light',
};

export interface OutfitPiece {
  name: string;
  color: string;
  fabric: string;
}

const MAX_PIECES = 2;
const MAX_FIELD = 60;

const clean = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .,'&\-/]/gu, '').trim().slice(0, MAX_FIELD) : '';

/** Validates the optional outfit description sent by the client. */
export function parseOutfit(value: unknown): OutfitPiece[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PIECES)
    .map((p) => ({ name: clean(p?.name), color: clean(p?.color), fabric: clean(p?.fabric).replace(/_/g, ' ') }))
    .filter((p) => p.name && p.color);
}

export function isScene(value: unknown): value is PhotorealScene {
  return value === 'studio' || value === 'city' || value === 'night';
}

export function buildPrompt(scene: PhotorealScene, outfit: OutfitPiece[]): string {
  const wearing = outfit.length
    ? ` The person is wearing ${outfit.map((p) => `a ${p.color.toLowerCase()} ${p.name}${p.fabric ? ` (${p.fabric})` : ''}`).join(' and ')}.`
    : '';
  return [
    'Turn this 3D render into a photorealistic full-body fashion photograph of the same person.',
    `Keep every garment exactly as shown: same garment types, colours, silhouettes, lengths and fit.${wearing}`,
    'Keep the pose, body proportions and camera framing exactly; arms stay in the same position.',
    'Realistic fabric texture, natural folds and stitching, natural skin, short neat hair, relaxed expression.',
    `Setting: ${SCENE_SETTINGS[scene]}.`,
    'Full body, head to toe in frame. No logos, no text, no watermark.',
  ].join(' ');
}
