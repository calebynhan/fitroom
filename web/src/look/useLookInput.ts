import { useMemo } from 'react';
import { useApp } from '../state/store';
import { lookInput, type LookInput } from './request';

/** The look on screen right now (memoised: zustand selectors must return stable values). */
export function useLookInput(): LookInput {
  const catalog = useApp((s) => s.catalog);
  const outfit = useApp((s) => s.outfit);
  const scene = useApp((s) => s.scene);
  const profile = useApp((s) => s.profile);
  const photos = useApp((s) => s.photos);
  const photoVersion = useApp((s) => s.photoVersion);
  return useMemo(
    () => lookInput({ catalog, outfit, scene, profile, photos, photoVersion }),
    [catalog, outfit, scene, profile, photos, photoVersion],
  );
}
