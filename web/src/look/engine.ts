// Which engine makes the photos. "space" (default, free): the shopper's own photos re-dressed by a virtual try-on
// model on a free Hugging Face Space (tryon/). "openai" (paid, VITE_PHOTO_ENGINE=openai): four generated views via
// /api/photoreal (look/). The rest of the app asks this module, so the UI doesn't branch on the engine everywhere.
import { useMemo } from 'react';
import type { View } from '@api/look';
import { useApp } from '../state/store';
import { cancelTryOn, makeTryOnLook, retryTryOnView, tryOnInput } from '../tryon/shoot';
import type { LookCaption } from './request';
import { makeLook, retryView } from './shoot';
import { useLookInput } from './useLookInput';

export type Engine = 'space' | 'openai';
export const ENGINE: Engine = import.meta.env.VITE_PHOTO_ENGINE === 'openai' ? 'openai' : 'space';
export const TRY_ON = ENGINE === 'space';

/** The views a new look will have, before it is shot (a try-on look adds the side photo on request). */
export function engineViews(): View[] {
  return TRY_ON ? ['front'] : ['front', 'three_quarter', 'side', 'back'];
}

export type ShotInput = { ready: true; key: string; caption: LookCaption; order: View[] } | { ready: false; missing: string[] };

function useTryOnInput(): ShotInput {
  const catalog = useApp((s) => s.catalog);
  const outfit = useApp((s) => s.outfit);
  const photos = useApp((s) => s.photos);
  const photoVersion = useApp((s) => s.photoVersion);
  return useMemo(() => tryOnInput({ catalog, outfit, photos, photoVersion }), [catalog, outfit, photos, photoVersion]);
}

function useGeneratedInput(): ShotInput {
  const input = useLookInput();
  return useMemo(() => (input.ready ? { ready: true, key: input.key, caption: input.caption, order: engineViews() } : input), [input]);
}

/** The look on screen right now, for whichever engine is in use. */
export const useShotInput: () => ShotInput = TRY_ON ? useTryOnInput : useGeneratedInput;

export function makeShots(): Promise<void> {
  return TRY_ON ? makeTryOnLook() : makeLook();
}

export function retryShot(key: string, view: View): Promise<void> {
  return TRY_ON ? retryTryOnView(key, view) : retryView(key, view);
}

/** Stops the shoot in progress, where the engine can (the free try-on; a paid OpenAI photo can't be stopped midway). */
export const cancelShots: (() => void) | null = TRY_ON ? cancelTryOn : null;
