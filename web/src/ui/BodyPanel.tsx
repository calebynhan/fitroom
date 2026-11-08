import { useEffect, useState } from 'react';
import {
  DEFAULT_GIRTHS,
  GIRTHS,
  SLIDER_COUNT,
  SLIDER_LABELS,
  WEIGHT_LIMIT,
  girthsForWeights,
  parseBodyMeasure,
  weightsForGirths,
  type BodyMeasure,
  type Girth,
  type Girths,
} from '../body/measurements';
import { useFit } from '../state/store';

const MEASURE_URL = '/models/body_measure.json';
const HEIGHT_RANGE: [number, number] = [150, 205];
const GIRTH_RANGE: [number, number] = [55, 150];

function useBodyMeasure(): BodyMeasure | null {
  const [measure, setMeasure] = useState<BodyMeasure | null>(null);
  useEffect(() => {
    fetch(MEASURE_URL)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then((data: unknown) => setMeasure(parseBodyMeasure(data)))
      .catch(() => setMeasure(null));
  }, []);
  return measure;
}

const inRange = (v: number, [lo, hi]: [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;

interface CmFieldProps {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function CmField({ label, value, disabled, onChange }: CmFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <span className="unit">cm</span>
    </label>
  );
}

export function BodyPanel() {
  const measure = useBodyMeasure();
  const heightCm = useFit((s) => s.heightCm);
  const setHeight = useFit((s) => s.setHeight);
  const weights = useFit((s) => s.weights);
  const setWeights = useFit((s) => s.setWeights);
  const setWeight = useFit((s) => s.setWeight);
  const [open, setOpen] = useState(true);
  const [heightText, setHeightText] = useState(String(heightCm));
  const [girthText, setGirthText] = useState<Record<Girth, string>>({
    chest: String(DEFAULT_GIRTHS.chest),
    waist: String(DEFAULT_GIRTHS.waist),
    hips: String(DEFAULT_GIRTHS.hips),
  });

  const onHeight = (text: string) => {
    setHeightText(text);
    const v = Number(text);
    if (inRange(v, HEIGHT_RANGE)) setHeight(v);
  };

  const onGirth = (g: Girth, text: string) => {
    const next = { ...girthText, [g]: text };
    setGirthText(next);
    const target = Object.fromEntries(GIRTHS.map((k) => [k, Number(next[k])])) as Girths;
    if (measure && weights && GIRTHS.every((k) => inRange(target[k], GIRTH_RANGE))) {
      setWeights(weightsForGirths(measure, target));
    }
  };

  const estimate = measure && weights ? girthsForWeights(measure, weights) : null;

  return (
    <aside className={`panel body-panel ${open ? '' : 'collapsed'}`} aria-label="Body">
      <button type="button" className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>Your body</h2>
        <span>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <>
          <div className="fields">
            <CmField label="Height" value={heightText} onChange={onHeight} />
            {GIRTHS.map((g) => (
              <CmField
                key={g}
                label={g[0].toUpperCase() + g.slice(1)}
                value={girthText[g]}
                disabled={!measure || !weights}
                onChange={(t) => onGirth(g, t)}
              />
            ))}
          </div>
          {!weights && <p className="hint">Body model loading. Sliders unlock when it arrives.</p>}
          {weights && !measure && <p className="hint">Measurement fitting needs body_measure.json; sliders work now.</p>}
          <div className="sliders">
            {SLIDER_LABELS.slice(0, SLIDER_COUNT).map((label, i) => (
              <label key={label} className="slider">
                <span>{label}</span>
                <input
                  type="range"
                  min={-WEIGHT_LIMIT}
                  max={WEIGHT_LIMIT}
                  step={0.05}
                  value={weights?.[i] ?? 0}
                  disabled={!weights || i >= weights.length}
                  onChange={(e) => setWeight(i, Number(e.target.value))}
                />
                <span className="slider-value">{(weights?.[i] ?? 0).toFixed(2)}</span>
              </label>
            ))}
          </div>
          {estimate && (
            <p className="hint">
              ≈ chest {estimate.chest.toFixed(0)} · waist {estimate.waist.toFixed(0)} · hips {estimate.hips.toFixed(0)} cm
            </p>
          )}
        </>
      )}
    </aside>
  );
}
