import { useEffect } from 'react';
import { GIRTH_RANGES, HEIGHT_RANGE, buildLabel } from '../body/builds';
import { GIRTHS, parseBodyMeasure, type Girth } from '../body/measurements';
import { MODEL_IDS, MODELS } from '../body/models';
import { useFit } from '../state/store';
import { Slider } from './Slider';
import { WordTabs } from './WordTabs';

const GIRTH_LABEL: Record<Girth, string> = { chest: 'Chest', waist: 'Waist', hips: 'Hips' };

function useMeasureLoader(): void {
  const setMeasure = useFit((s) => s.setMeasure);
  const model = useFit((s) => s.model);
  useEffect(() => {
    let alive = true; // ignore a late response after switching models
    fetch(MODELS[model].measureUrl)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then((data: unknown) => alive && setMeasure(parseBodyMeasure(data)))
      .catch((err: unknown) => {
        console.error('[body] measure json failed to load', err);
        if (alive) setMeasure(null);
      });
    return () => {
      alive = false;
    };
  }, [setMeasure, model]);
}

export function BodySection() {
  useMeasureLoader();
  const model = useFit((s) => s.model);
  const setModel = useFit((s) => s.setModel);
  const heightCm = useFit((s) => s.heightCm);
  const setHeight = useFit((s) => s.setHeight);
  const girths = useFit((s) => s.girths);
  const setGirths = useFit((s) => s.setGirths);
  const ready = useFit((s) => Boolean(s.measure && s.weights));

  const { builds } = MODELS[model];
  const label = buildLabel(builds, girths);
  const buildIndex = Math.max(0, builds.findIndex((b) => b.label === label));

  return (
    <section className="rail-section">
      <div className="section-head">
        <h2 className="eyebrow">Your body</h2>
        <WordTabs
          label="Model"
          options={MODEL_IDS.map((id) => ({ id, label: MODELS[id].label }))}
          value={model}
          onChange={setModel}
        />
      </div>
      <Slider label="Height" value={heightCm} min={HEIGHT_RANGE.min} max={HEIGHT_RANGE.max} unit="cm" onChange={setHeight} />
      <Slider label="Build" value={buildIndex} min={0} max={builds.length - 1} display={label} onChange={(i) => setGirths(builds[i].girths)} />
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
