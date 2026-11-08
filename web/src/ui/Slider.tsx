import { useEffect, useState } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Text shown instead of an editable number (e.g. "Lean"). */
  display?: string;
  unit?: string;
  onChange: (value: number) => void;
}

/** Hairline slider from the design: brass fill, square black thumb, editable value. */
export function Slider({ label, value, min, max, step = 1, display, unit, onChange }: SliderProps) {
  const pct = `${((value - min) / (max - min)) * 100}%`;
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v))));
    else setText(String(value));
  };

  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        {display !== undefined ? (
          <span className="slider-value">{display}</span>
        ) : (
          <span className="slider-value">
            <input
              className="slider-number"
              type="text"
              inputMode="numeric"
              value={text}
              aria-label={`${label} in ${unit ?? ''}`}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{ width: `${Math.max(2, text.length) + 0.5}ch` }}
            />
            {unit && ` ${unit}`}
          </span>
        )}
      </div>
      <div className="slider-track">
        <div className="slider-line" />
        <div className="slider-fill" style={{ width: pct }} />
        <div className="slider-thumb" style={{ left: pct }} />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}
