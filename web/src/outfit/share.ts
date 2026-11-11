// Outfits as links: ?top=E453754-000.67.S&bottom=E475598-000.09&scene=studio
// Only what was picked (item, colour, a hand-picked size, the setting). Never photos or measurements: a link may be
// posted anywhere, and the recipient gets their own size from their own measurements.
import type { Selection, Slot } from '../catalog/types';
import type { SceneId } from '../look/scenes';

export type SharedOutfit = { outfit: Partial<Record<Slot, Selection>>; scene?: SceneId };

const ID = /^E\d{6}-\d{3}$/;
const CODE = /^[A-Za-z0-9]{1,8}$/;
const SIZE = /^[A-Za-z0-9.]{1,12}$/;
const SCENES: readonly string[] = ['studio', 'city', 'night'];

function encodeSelection(s: Selection): string {
  return [s.itemId, s.colorCode, ...(s.size ? [s.size] : [])].join('.');
}

/** "E453754-000.67.S" -> selection, or null when malformed (links get mangled in chats). */
export function decodeSelection(value: string | null): Selection | null {
  if (!value) return null;
  const m = value.trim().match(/^(E\d{6}-\d{3})\.([A-Za-z0-9]{1,8})(?:\.([A-Za-z0-9.]{1,12}))?$/);
  if (!m || !ID.test(m[1]) || !CODE.test(m[2])) return null;
  return { itemId: m[1], colorCode: m[2], ...(m[3] && SIZE.test(m[3]) ? { size: m[3] } : {}) };
}

/** The query string for an outfit ("?top=...&bottom=...&scene=..."). */
export function outfitQuery(o: SharedOutfit): string {
  const params = new URLSearchParams();
  if (o.outfit.top) params.set('top', encodeSelection(o.outfit.top));
  if (o.outfit.bottom) params.set('bottom', encodeSelection(o.outfit.bottom));
  if (o.scene) params.set('scene', o.scene);
  return `?${params.toString()}`;
}

export function shareUrl(o: SharedOutfit, origin: string): string {
  return `${origin}/${outfitQuery(o)}`;
}

/** The outfit in a URL's query, or null when it has none. */
export function parseOutfitQuery(search: string): SharedOutfit | null {
  const params = new URLSearchParams(search);
  const top = decodeSelection(params.get('top'));
  const bottom = decodeSelection(params.get('bottom'));
  if (!top && !bottom) return null;
  const scene = params.get('scene');
  return {
    outfit: { ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) },
    ...(scene && SCENES.includes(scene) ? { scene: scene as SceneId } : {}),
  };
}
