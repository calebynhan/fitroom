import { useMemo } from 'react';
import { useLooks, type Look } from '../state/looks';
import { useApp } from '../state/store';
import { reachableLooks } from '../tryon/shoot';

const firstPhoto = (look: Look) => {
  const view = look.order.find((v) => look.views[v].kind === 'done');
  const state = view ? look.views[view] : null;
  return state?.kind === 'done' ? state.image : null;
};

/** "Washable Milano Ribbed Sweater in Blue" -> "Blue Washable Milano Ribbed Sweater": the colour is what differs most. */
export function colourFirst(caption: string): string {
  const i = caption.lastIndexOf(' in ');
  return i > 0 ? `${caption.slice(i + 4)} ${caption.slice(0, i)}` : caption;
}

/** "Your try-ons": every outfit already tried on these photos; one tap goes back to it (it costs nothing). */
export function LooksStrip({ currentKey }: { currentKey: string | null }) {
  const looks = useLooks((s) => s.looks);
  const busy = useLooks((s) => s.busy);
  const applyOutfit = useApp((s) => s.applyOutfit);
  const photoVersion = useApp((s) => s.photoVersion);
  // photoVersion: looks made from replaced photos drop out
  const list = useMemo(() => reachableLooks(looks), [looks, photoVersion]);
  if (list.length < 2) return null;
  return (
    <section className="looks-strip" aria-labelledby="looks-strip-title">
      <h2 className="eyebrow" id="looks-strip-title">
        Your try-ons ({list.length})
      </h2>
      <ul>
        {list.map((look) => {
          const src = firstPhoto(look);
          const current = look.key === currentKey;
          return (
            <li key={look.key}>
              <button
                type="button"
                className={`look-thumb ${current ? 'current' : ''}`}
                aria-pressed={current}
                disabled={busy !== null}
                onClick={() => look.outfit && applyOutfit(look.outfit)}
              >
                {src && <img src={src} alt="" />}
                <span className="look-thumb-name">
                  {!current && <span className="sr-only">Back to </span>}
                  {[look.caption.top, look.caption.bottom].filter((c): c is string => Boolean(c)).map((c) => (
                    <span key={c}>{colourFirst(c)}</span>
                  ))}
                  {current && <span className="sr-only"> (on screen)</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
