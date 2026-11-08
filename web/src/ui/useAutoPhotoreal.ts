import { useEffect, useState } from 'react';
import { usePhoto } from '../state/photo';
import { useFit, useLookKey } from '../state/store';
import { makeItReal } from './usePhotoreal';

/** How long the look must stay unchanged before a photograph is composed (avoids paying for every click). */
const SETTLE_MS = 3500;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** "Make it real" without the button: once the dressed look settles, compose its photograph. */
export function useAutoPhotoreal(): void {
  const key = useLookKey();
  const dressed = useFit((s) => s.dressed);
  const visible = useDocumentVisible();
  const blocked = usePhoto((s) => s.photo.kind !== 'idle' || s.autoOff || s.remaining === 0 || key in s.shots);

  useEffect(() => {
    if (!dressed || !visible || blocked) return undefined;
    const timer = window.setTimeout(() => void makeItReal({ auto: true }), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [key, dressed, visible, blocked]);
}
