import type { FitCard } from '../fit/fitCard';

/** The fit card as a small table: one column per size, one row per measurement. */
export function FitTable({ card, caption, firstTag, className = '' }: { card: FitCard; caption: string; firstTag?: string; className?: string }) {
  if (card.rows.length === 0) return null;
  return (
    <div className={`fit-card ${className}`}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <td />
            {card.sizes.map((s, i) => (
              <th key={`${s}-${i}`} scope="col">
                {s}
                {i === 0 && firstTag && card.sizes.length > 1 && <span className="fit-card-tag"> · {firstTag}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td key={i}>
                  <span className="fit-main">{cell.main}</span>
                  {cell.sub && <span className="fit-sub">{cell.sub}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {card.notes.map((n) => (
        <p key={n} className="note fine">
          {n}
        </p>
      ))}
    </div>
  );
}
