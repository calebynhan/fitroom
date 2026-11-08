import { useEffect } from 'react';
import { BUILDS, GIRTH_RANGES, HEIGHT_RANGE, buildLabel } from '../body/builds';
import { GIRTHS, parseBodyMeasure, type Girth } from '../body/measurements';
import { useFit } from '../state/store';
import { Slider } from './Slider';

const MEASURE_URL = '/models/body_measure.json';
const GIRTH_LABEL: Record<Girth, string> = { chest: 'Chest', waist: 'Waist', hips: 'Hips' };

function useMeasureLoader(): void {
  const setMeasure = useFit((s) => s.setMeasure);
  useEffect(() => {
    fetch(MEASURE_URL)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then((data: unknown) => setMeasure(parseBodyMeasure(data)))
      .catch((err: unknown) => {
        console.error('[body] body_measure.json failed to load', err);
        setMeasure(null);
      });
  }, [setMeasure]);
}

export function BodySection() {
  useMeasureLoader();
  const heightCm = useFit((s) => s.heightCm);
  const setHeight = useFit((s) => s.setHeight);
  const girths = useFit((s) => s.girths);
  const setGirths = useFit((s) => s.setGirths);
  const ready = useFit((s) => Boolean(s.measure && s.weights));

  const label = buildLabel(girths);
  const buildIndex = Math.max(0, BUILDS.findIndex((b) => b.label === label));

  return (
    <section className="rail-section">
      <h2 className="eyebrow">Your body</h2>
      <Slider label="Height" value={heightCm} min={HEIGHT_RANGE.min} max={HEIGHT_RANGE.max} unit="cm" onChange={setHeight} />
      <Slider
        label="Build"
        value={buildIndex}
        min={0}
        max={BUILDS.length - 1}
        display={label}
        onChange={(i) => setGirths(BUILDS[i].girths)}
      />
      {GIRTHS.map((g) => (
        <Slider
          key={g}
          label={GIRTH_LABEL[g]}
          value={girths[g]}
          min={GIRTH_RANGES[g].min}
          max={GIRTH_RANGES[g].max}
          unit="cm"
          onChange={(v) => setGirths({ ...girths, [g]: v })}
        />
      ))}
      {!ready && <p className="note">Loading your body model…</p>}
    </section>
  );
}
