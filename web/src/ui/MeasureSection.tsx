import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  estimate,
  fromDisplay,
  fromFeetInches,
  inRange,
  LIMITS,
  toDisplay,
  toFeetInches,
  unitLabel,
  type MeasureKey,
  type OptionalKey,
  type Units,
} from '../body/profile';
import { useApp } from '../state/store';
import { WordTabs } from './WordTabs';

const LABEL: Record<MeasureKey, string> = {
  heightCm: 'Height',
  weightKg: 'Weight',
  chestCm: 'Chest',
  waistCm: 'Waist',
  hipsCm: 'Hips',
  inseamCm: 'Inseam',
};

const fmt = (n: number | null) => (n === null ? '' : String(n));

interface NumberBoxProps {
  id?: string;
  value: number | null;
  placeholder?: string;
  label: string;
  suffix: string;
  invalid: boolean;
  onCommit: (value: number | null) => void;
  /** The text went back to the stored value (clears a stale range error). */
  onRevert: () => void;
}

/** Free-typed number; commits on blur / Enter, and only when the text really changed (no unit-rounding drift). */
function NumberBox({ id, value, placeholder, label, suffix, invalid, onCommit, onRevert }: NumberBoxProps) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const t = text.trim().replace(',', '.');
    if (t === fmt(value)) return onRevert();
    if (t === '') return onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setText(fmt(value));
  };
  return (
    <span className={`num-box ${invalid ? 'invalid' : ''}`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="num-unit">{suffix}</span>
    </span>
  );
}

function rangeText(key: MeasureKey, units: Units): string {
  const [min, max] = LIMITS[key];
  if (key === 'heightCm' && units === 'imperial') {
    const lo = toFeetInches(min);
    const hi = toFeetInches(max);
    return `${lo.ft}'${lo.in}" to ${hi.ft}'${hi.in}"`;
  }
  return `${toDisplay(key, min, units)}–${toDisplay(key, max, units)} ${unitLabel(key, units)}`;
}

function useMeasure(key: MeasureKey) {
  const value = useApp((s) => s.profile[key]);
  const units = useApp((s) => s.profile.units);
  const setProfile = useApp((s) => s.setProfile);
  const [error, setError] = useState<string | null>(null);
  const commitMetric = (metric: number | null) => {
    if (metric !== null && !inRange(key, metric)) {
      setError(`${LABEL[key]}: ${rangeText(key, units)}`);
      return;
    }
    setError(null);
    setProfile({ [key]: metric });
  };
  return { value, units, error, commitMetric, clearError: () => setError(null) };
}

function HeightField() {
  const { value, units, error, commitMetric, clearError } = useMeasure('heightCm');
  const id = useId();
  if (units === 'metric') {
    return (
      <Field label="Height" htmlFor={id} required error={error}>
        <NumberBox id={id} label="Height in cm" suffix="cm" value={value === null ? null : Math.round(value)} placeholder="178" invalid={!!error} onCommit={(n) => commitMetric(n)} onRevert={clearError} />
      </Field>
    );
  }
  return (
    <Field label="Height" htmlFor={id} required error={error}>
      <FeetInchesBox id={id} value={value} invalid={!!error} onCommit={commitMetric} onRevert={clearError} />
    </Field>
  );
}

/** Feet + inches as one value: both boxes are read together, so typing inches first is fine. */
function FeetInchesBox({ id, value, invalid, onCommit, onRevert }: { id: string; value: number | null; invalid: boolean; onCommit: (cm: number | null) => void; onRevert: () => void }) {
  const fi = value === null ? null : toFeetInches(value);
  const [ft, setFt] = useState(fmt(fi?.ft ?? null));
  const [inch, setInch] = useState(fmt(fi?.in ?? null));
  useEffect(() => {
    const next = value === null ? null : toFeetInches(value);
    setFt(fmt(next?.ft ?? null));
    setInch(fmt(next?.in ?? null));
  }, [value]);
  const commit = () => {
    if (ft.trim() === fmt(fi?.ft ?? null) && inch.trim() === fmt(fi?.in ?? null)) return onRevert();
    if (ft.trim() === '' && inch.trim() === '') return onCommit(null);
    if (ft.trim() === '') return; // wait for the feet
    const f = Number(ft);
    const i = Number(inch.trim() || '0');
    if (Number.isFinite(f) && Number.isFinite(i) && f > 0 && i >= 0) onCommit(fromFeetInches(f, i));
  };
  const box = (label: string, suffix: string, text: string, setText: (t: string) => void, placeholder: string, boxId?: string) => (
    <span className={`num-box ${invalid ? 'invalid' : ''}`}>
      <input
        id={boxId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="num-unit">{suffix}</span>
    </span>
  );
  return (
    <span className="num-pair">
      {box('Height, feet', 'ft', ft, setFt, '5', id)}
      {box('Height, inches', 'in', inch, setInch, '10')}
    </span>
  );
}

function MeasureField({ k, estimateCm }: { k: 'weightKg' | OptionalKey; estimateCm?: number }) {
  const { value, units, error, commitMetric, clearError } = useMeasure(k);
  const id = useId();
  const unit = unitLabel(k, units);
  const optional = k !== 'weightKg';
  return (
    <Field label={LABEL[k]} htmlFor={id} required={!optional} error={error}>
      <NumberBox
        id={id}
        label={`${LABEL[k]} in ${unit}`}
        suffix={unit}
        value={value === null ? null : toDisplay(k, value, units)}
        placeholder={estimateCm !== undefined ? `≈ ${toDisplay(k, estimateCm, units)}` : k === 'weightKg' ? (units === 'metric' ? '65' : '143') : ''}
        invalid={!!error}
        onCommit={(n) => commitMetric(n === null ? null : fromDisplay(k, n, units))}
        onRevert={clearError}
      />
    </Field>
  );
}

function Field({ label, htmlFor, required, error, children }: { label: string; htmlFor: string; required: boolean; error: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {!required && <span className="field-opt"> optional</span>}
      </label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function MeasureSection() {
  const profile = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  const est = inRange('heightCm', profile.heightCm) && inRange('weightKg', profile.weightKg) ? estimate(profile.heightCm, profile.weightKg) : null;
  const estimated = est && (['chestCm', 'waistCm', 'hipsCm', 'inseamCm'] as const).some((k) => profile[k] === null);

  return (
    <section className="rail-section" aria-labelledby="measure-title">
      <div className="section-head">
        <h2 className="eyebrow" id="measure-title">
          Measurements
        </h2>
        <WordTabs
          label="Units"
          options={[
            { id: 'imperial', label: 'in · lb' },
            { id: 'metric', label: 'cm · kg' },
          ]}
          value={profile.units}
          onChange={(units) => setProfile({ units })}
        />
      </div>
      <div className="measure-grid">
        <HeightField />
        <MeasureField k="weightKg" />
        {(['chestCm', 'waistCm', 'hipsCm', 'inseamCm'] as const).map((k) => (
          <MeasureField key={k} k={k} estimateCm={est?.[k]} />
        ))}
      </div>
      <p className="note">
        {estimated
          ? 'Blank measurements are estimated from your height and weight (≈). Tape-measure them for a truer fit.'
          : 'Chest, waist, hips and inseam are optional: leave them blank and we estimate them from your height and weight.'}
      </p>
    </section>
  );
}
