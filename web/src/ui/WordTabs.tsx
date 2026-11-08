interface WordTabsProps<T extends string> {
  label: string;
  options: { id: T; label: string }[];
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
          className={o.id === value ? 'active' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
