interface WordTabsProps<T extends string> {
  label: string;
  options: { id: T; label: string; disabled?: boolean; note?: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

/** Text-only segmented control from the design ("scene as words"): active word is underlined. */
export function WordTabs<T extends string>({ label, options, value, onChange, className = '' }: WordTabsProps<T>) {
  return (
    <div className={`word-tabs ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          disabled={o.disabled}
          title={o.note}
          className={o.id === value ? 'active' : ''}
          onClick={() => !o.disabled && onChange(o.id)}
        >
          {o.label}
          {o.note && <span className="word-note">{o.note}</span>}
        </button>
      ))}
    </div>
  );
}
