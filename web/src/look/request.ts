// Turns the app state into the parts of a /api/photoreal request that every view of a look shares, plus a key:
// two states with the same key would produce the same photographs.
import type { LookPhotos, LookPiece, LookRequest } from '@api/look';
import { completeBody, sizingBody } from '../body/profile';
import { findColor, productImage, type CatalogItem, type Selection, type Slot } from '../catalog/types';
import { easeFor, formatSize, lengthFor, recommendSize } from '../fit/sizing';
import type { useApp } from '../state/store';
import { SCENES } from './scenes';

type AppSnapshot = Pick<ReturnType<typeof useApp.getState>, 'catalog' | 'outfit' | 'scene' | 'profile' | 'photos' | 'photoVersion'>;

export type LookBase = Omit<LookRequest, 'view' | 'reference' | 'lookToken'>;

export interface LookCaption {
  top: string | null;
  bottom: string | null;
  meta: string;
}

export type LookInput = { ready: true; key: string; base: LookBase; caption: LookCaption } | { ready: false; missing: string[] };

interface Worn {
  item: CatalogItem;
  selection: Selection;
  size: string | undefined;
}

function worn(state: AppSnapshot, slot: Slot): Worn | null {
  const selection = state.outfit[slot];
  const item = selection && state.catalog.find((i) => i.id === selection.itemId);
  if (!item || !selection) return null;
  const body = sizingBody(state.profile);
  const size = selection.size ?? (body ? recommendSize(item, body) ?? undefined : undefined);
  return { item, selection, size };
}

function toPiece(w: Worn, state: AppSnapshot): LookPiece {
  const body = sizingBody(state.profile);
  const piece: LookPiece = {
    slot: w.item.slot,
    name: w.item.name,
    color: findColor(w.item, w.selection.colorCode).name,
    fabric: w.item.fabric,
  };
  if (w.size) piece.size = w.size;
  const ease = w.size && body ? easeFor(w.item, w.size, body) : undefined;
  const length = w.size && body ? lengthFor(w.item, w.size, body) : undefined;
  const image = productImage(w.item, w.selection.colorCode);
  if (ease) piece.ease = ease;
  if (length) piece.length = length;
  if (image) piece.image = image;
  return piece;
}

/** What is still needed before a look can be shot, in the order the shopper fills it in. */
export function missingParts(state: AppSnapshot): string[] {
  const missing: string[] = [];
  if (!state.photos.front) missing.push('front photo');
  if (!state.photos.side) missing.push('side photo');
  if (!state.photos.face) missing.push('face profile');
  if (!completeBody(state.profile)) missing.push('height and weight');
  if (!state.outfit.top && !state.outfit.bottom) missing.push('something to wear');
  return missing;
}

export function lookInput(state: AppSnapshot): LookInput {
  const missing = missingParts(state);
  const body = completeBody(state.profile);
  const { front, side, face } = state.photos;
  if (missing.length || !body || !front || !side || !face) return { ready: false, missing };

  const pieces = (['top', 'bottom'] as const).map((slot) => worn(state, slot)).filter((w): w is Worn => w !== null);
  const items = pieces.map((w) => toPiece(w, state));
  const photos: LookPhotos = { front: front.dataUrl, side: side.dataUrl, face: face.dataUrl };
  const base: LookBase = { scene: state.scene, body, items, photos };
  const describe = (slot: Slot) => {
    const w = pieces.find((p) => p.item.slot === slot);
    return w ? `${w.item.name} in ${findColor(w.item, w.selection.colorCode).name}` : null;
  };
  const sizes = pieces.filter((p) => p.size).map((p) => `${p.item.slot === 'top' ? 'Top' : 'Bottoms'} ${formatSize(p.size!)}`);
  const caption: LookCaption = {
    top: describe('top'),
    bottom: describe('bottom'),
    meta: [...sizes, SCENES[state.scene].label, `${Math.round(body.heightCm)}\u00a0cm`].join(' · '),
  };
  const key = JSON.stringify({ v: state.photoVersion, scene: state.scene, body, items });
  return { ready: true, key, base, caption };
}
