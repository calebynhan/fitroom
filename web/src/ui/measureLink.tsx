// "Measure my chest": takes the shopper to the measurement that would settle a borderline size.
import type { Borderline } from '../fit/sizing';

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** Scrolls to the Measurements section and focuses that field (MeasureSection names its inputs by key). */
export function goToMeasure(measure: Borderline['measure']): void {
  const input = document.querySelector<HTMLInputElement>(`#measure input[name="${measure}"]`);
  if (!input) return;
  input.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  input.focus({ preventScroll: true });
}

export function MeasureLink({ borderline }: { borderline: Borderline }) {
  return (
    <button type="button" className="link-btn measure-link" onClick={() => goToMeasure(borderline.measure)}>
      Measure my {borderline.label}
    </button>
  );
}
