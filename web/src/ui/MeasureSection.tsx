import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  completeBody,
  estimate,
  FIT_PREFS,
  fitPrefs,
  fromDisplay,
  fromFeetInches,
  inRange,
  displayRange,
  heightRangeFeet,
  REFERENCE,
  toDisplay,
  toFeetInches,
  unitLabel,
  type FitPref,
  type MeasureKey,
  type OptionalKey,
  type ReferenceKey,
  type Units,
} from '../body/profile';
import { formatLength } from '../fit/fitCard';
import { easeOfRoom } from '../fit/sizing';
import { useApp } from '../state/store';
import { WordTabs } from './WordTabs';

const LABEL: Record<MeasureKey, string> = {
  heightCm: 'Height',
  weightKg: 'Weight',
  chestCm: 'Chest',
  waistCm: 'Waist',
  hipsCm: 'Hips',
  inseamCm: 'Inseam',
  refTopChestFlatCm: 'Chest, flat',
  refTopLengthCm: 'Length',
  refBottomHipsFlatCm: 'Hips, flat',
  refBottomInseamCm: 'Inseam',
};

/** How to measure a garment laid flat; shown under the field label. */
const HINT: Partial<Record<MeasureKey, string>> = {
  refTopChestFlatCm: 'armpit to armpit',
  refTopLengthCm: 'collar seam to hem',
  refBottomHipsFlatCm: 'across the seat',
  refBottomInseamCm: 'crotch to hem',
};

const fmt = (n: number | null) => (n === null ? '' : String(n));

interface NumberBoxProps {
  id?: string;
  name: string;
  describedBy?: string;
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
function NumberBox({ id, name, describedBy, value, placeholder, label, suffix, invalid, onCommit, onRevert }: NumberBoxProps) {
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
        name={name}
        aria-describedby={describedBy}
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
  if (key === 'heightCm' && units === 'imperial') {
    const [lo, hi] = heightRangeFeet();
    return `${lo.ft}'${lo.in}" to ${hi.ft}'${hi.in}"`;
  }
  const [lo, hi] = displayRange(key, units);
  return `${lo}–${hi} ${unitLabel(key, units)}`;
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
        <NumberBox id={id} name="heightCm" describedBy={`${id}-error`} label="Height in cm" suffix="cm" value={value === null ? null : toDisplay('heightCm', value, 'metric')} placeholder="178" invalid={!!error} onCommit={(n) => commitMetric(n)} onRevert={clearError} />
      </Field>
    );
  }
  return (
    <Field label="Height" htmlFor={id} required error={error}>
      <FeetInchesBox id={id} describedBy={`${id}-error`} value={value} invalid={!!error} onCommit={commitMetric} onRevert={clearError} />
    </Field>
  );
}

/** Feet + inches as one value: both boxes are read together, so typing inches first is fine. */
interface FeetInchesProps {
  id: string;
  describedBy: string;
  value: number | null;
  invalid: boolean;
  onCommit: (cm: number | null) => void;
  onRevert: () => void;
}

function FeetInchesBox({ id, describedBy, value, invalid, onCommit, onRevert }: FeetInchesProps) {
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
  const box = (label: string, name: string, suffix: string, text: string, setText: (t: string) => void, placeholder: string, boxId?: string) => (
    <span className={`num-box ${invalid ? 'invalid' : ''}`}>
      <input
        id={boxId}
        name={name}
        aria-describedby={describedBy}
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
      {box('Height, feet', 'heightFt', 'ft', ft, setFt, '5', id)}
      {box('Height, inches', 'heightIn', 'in', inch, setInch, '10')}
    </span>
  );
}

function MeasureField({ k, estimateCm }: { k: 'weightKg' | OptionalKey | ReferenceKey; estimateCm?: number }) {
  const { value, units, error, commitMetric, clearError } = useMeasure(k);
  const id = useId();
  const unit = unitLabel(k, units);
  const optional = k !== 'weightKg';
  return (
    <Field label={LABEL[k]} htmlFor={id} required={!optional} hint={HINT[k]} error={error}>
      <NumberBox
        id={id}
        name={k}
        describedBy={`${id}-error`}
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

interface FieldProps {
  label: string;
  htmlFor: string;
  required: boolean;
  /** Shown instead of "optional" (how to measure it). */
  hint?: string;
  error: string | null;
  children: ReactNode;
}

function Field({ label, htmlFor, required, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {hint ? <span className="field-opt"> {hint}</span> : !required && <span className="field-opt"> optional</span>}
      </label>
      {children}
      <span className="field-error" id={`${htmlFor}-error`} aria-live="polite">
        {error}
      </span>
    </div>
  );
}

export function MeasureSection() {
  const profile = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  const est = inRange('heightCm', profile.heightCm) && inRange('weightKg', profile.weightKg) ? estimate(profile.heightCm, profile.weightKg) : null;
  const estimated = est && (['chestCm', 'waistCm', 'hipsCm', 'inseamCm'] as const).some((k) => profile[k] === null);
  // chest decides tops and waist decides pants: the two worth a tape measure
  const deciding = (['chestCm', 'waistCm'] as const).filter((k) => profile[k] === null).map((k) => (k === 'chestCm' ? 'chest' : 'waist'));

  return (
    <section className="rail-section" id="measure" aria-labelledby="measure-title">
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
        {!estimated
          ? 'Chest, waist, hips and inseam are optional: leave them blank and they are estimated from your height and weight.'
          : deciding.length
            ? `Blank measurements are estimated from your height and weight (≈), often a size off. Measuring your ${deciding.join(' and ')} (2 minutes with a tape) settles most sizes.`
            : 'Blank measurements are estimated from your height and weight (≈). Tape-measure them for a truer fit.'}
      </p>
    </section>
  );
}

const PREF_OPTIONS: { id: FitPref; label: string }[] = FIT_PREFS.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));

/** "That top has 12 cm of room on you: a regular fit." from the shopper's own garment against their body. */
function referenceFeedback(slot: 'top' | 'bottom', garmentCm: number | undefined, bodyCm: number | undefined, units: Units): string | null {
  if (garmentCm === undefined || bodyCm === undefined) return null;
  const room = garmentCm - bodyCm;
  const [what, measure, give] = slot === 'top' ? ['That top', 'measures', 'gives'] : ['Those pants', 'measure', 'give'];
  const where = slot === 'top' ? 'chest' : 'hips';
  if (room < 0) {
    return `${what} ${measure} ${formatLength(-room, units)} less around the ${where} than you do. Check ${slot === 'top' ? 'it was' : 'they were'} laid flat and measured straight across.`;
  }
  // more than double the most oversized fit: almost always measured all the way round instead of flat
  if (room > 50) {
    return `${what} would give you ${formatLength(room, units)} of room at the ${where}, far more than any fit. Lay ${slot === 'top' ? 'it' : 'them'} flat and measure straight across the front only, not all the way around.`;
  }
  return `${what} ${give} you ${formatLength(room, units)} of room at the ${where}: a ${easeOfRoom(slot, room)} fit. Sizes are matched to it.`;
}

/** How the shopper likes clothes to fit: a preference per slot, or a garment of their own that fits well. */
export function FitSection() {
  const profile = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  const prefs = fitPrefs(profile);
  const body = completeBody(profile);
  const hasRef = REFERENCE.some((k) => profile[k] !== null);
  // open when there are measurements, then the shopper's to close: clearing the last field must not snap it shut
  const [refOpen, setRefOpen] = useState(hasRef);
  const topFeedback = referenceFeedback('top', prefs.top.chestCm, body?.chestCm, profile.units);
  const bottomFeedback = referenceFeedback('bottom', prefs.bottom.hipsCm, body?.hipsCm, profile.units);

  const prefRow = (slot: 'top' | 'bottom', label: string) => {
    const measured = slot === 'top' ? prefs.top.chestCm !== undefined : prefs.bottom.hipsCm !== undefined;
    return (
      <div className="pref-row">
        <span className="pref-label">{label}</span>
        <WordTabs
          label={`How you like ${label.toLowerCase()} to fit`}
          options={PREF_OPTIONS}
          value={slot === 'top' ? profile.fitTop : profile.fitBottom}
          onChange={(pref) => setProfile(slot === 'top' ? { fitTop: pref } : { fitBottom: pref })}
        />
        {measured && <span className="pref-note">Matched to the {slot === 'top' ? 'top' : 'pants'} you measured instead</span>}
      </div>
    );
  };

  return (
    <section className="rail-section" id="fit" aria-labelledby="fit-title">
      <h2 className="eyebrow" id="fit-title">
        How you like it to fit
      </h2>
      <div className="prefs">
        {prefRow('top', 'Tops')}
        {prefRow('bottom', 'Bottoms')}
      </div>
      <details className="ref-garment" open={refOpen} onToggle={(e) => setRefOpen(e.currentTarget.open)}>
        <summary>
          Measure clothes that fit you well <span className="field-opt">optional</span>
        </summary>
        <p className="note">Lay it flat and measure straight across. You get the UNIQLO size that measures closest to it.</p>
        <div className="ref-group">
          <span className="ref-title">A top</span>
          <div className="measure-grid">
            <MeasureField k="refTopChestFlatCm" />
            <MeasureField k="refTopLengthCm" />
          </div>
          {topFeedback && <p className="note ref-feedback">{topFeedback}</p>}
        </div>
        <div className="ref-group">
          <span className="ref-title">Pants</span>
          <div className="measure-grid">
            <MeasureField k="refBottomHipsFlatCm" />
            <MeasureField k="refBottomInseamCm" />
          </div>
          {bottomFeedback && <p className="note ref-feedback">{bottomFeedback}</p>}
        </div>
      </details>
      <p className="note">Your recommended sizes follow this. The size chart still decides how each size sits on you, in the numbers and the photos.</p>
    </section>
  );
}
