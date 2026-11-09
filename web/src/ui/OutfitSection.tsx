import { useState } from 'react';
import { completeBody } from '../body/profile';
import { colorImage, findColor, formatPrice, type CatalogItem, type Selection, type Slot } from '../catalog/types';
import { chartSizes, easeFor, fitSummary, formatSize, lengthFor, shortSize, sizeAdvice } from '../fit/sizing';
import { useApp } from '../state/store';
import { PasteLink } from './PasteLink';

const CUT_LABEL: Record<CatalogItem['fit'], string> = { slim: 'Slim cut', regular: 'Regular cut', relaxed: 'Relaxed cut' };

function Thumb({ item, code, slot }: { item: CatalogItem; code: string; slot: Slot }) {
  const [failures, setFailures] = useState<{ code: string; count: number }>({ code, count: 0 });
  const count = failures.code === code ? failures.count : 0;
  // This colour's shot, then the default shot, then a plain tile.
  const sources = [findColor(item, code).image ?? colorImage(item.image, code), item.image].filter(Boolean);
  const src = sources[count];
  return (
    <div className="thumb">
      {src ? <img src={src} alt="" loading="lazy" onError={() => setFailures({ code, count: count + 1 })} /> : <span>{slot}</span>}
    </div>
  );
}

function SizePicker({ item, selection }: { item: CatalogItem; selection: Selection }) {
  const profile = useApp((s) => s.profile);
  const setSize = useApp((s) => s.setSize);
  const body = completeBody(profile);
  const sizes = chartSizes(item);
  const advice = body ? sizeAdvice(item, body) : null;
  const chosen = selection.size ?? advice?.size;
  const summary = body && chosen ? fitSummary(easeFor(item, chosen, body), lengthFor(item, chosen, body)) : null;

  if (sizes.length === 0) return <p className="size-note">No size chart for this item, so the shots show your usual size.</p>;
  return (
    <div className="sizes">
      <div className="size-chips" role="radiogroup" aria-label={`${item.name} size`}>
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === chosen}
            className={`size-chip ${s === chosen ? 'active' : ''} ${s === advice?.size ? 'yours' : ''}`}
            title={s === advice?.size ? 'Your size' : undefined}
            onClick={() => setSize(item.slot, s === advice?.size ? undefined : s)}
          >
            {shortSize(s)}
          </button>
        ))}
      </div>
      <p className="size-note">
        {advice ? advice.text : 'Add your height and weight to get your size.'}
        {summary && chosen && (
          <>
            {' '}
            <span className="size-fit">
              {formatSize(chosen)}: {summary.charAt(0).toLowerCase() + summary.slice(1)}.
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function ProductCard({ item, selection }: { item: CatalogItem; selection: Selection }) {
  const setColor = useApp((s) => s.setColor);
  const color = findColor(item, selection.colorCode);
  return (
    <div className="product">
      <Thumb item={item} code={color.code} slot={item.slot} />
      <div className="product-body">
        <div className="product-meta">
          <span>{item.slot === 'top' ? 'Top' : 'Bottoms'}</span>
          <span>{color.name}</span>
        </div>
        <div className="product-name">{item.name}</div>
        <div className="product-price">
          {item.salePrice !== null && <s>${item.price.toFixed(2)}</s>} {formatPrice(item)}
          <span className="product-fit"> · {CUT_LABEL[item.fit] ?? 'Regular cut'}</span>
        </div>
        <div className="product-foot">
          <div className="swatches" role="radiogroup" aria-label={`${item.name} colour`}>
            {item.colors.map((c) => (
              <button
                key={c.code}
                type="button"
                role="radio"
                aria-checked={c.code === color.code}
                title={c.name}
                className={`swatch ${c.code === color.code ? 'active' : ''}`}
                onClick={() => setColor(item.slot, c.code)}
              >
                <span style={{ background: c.hex }} />
              </button>
            ))}
          </div>
          <a href={item.url} target="_blank" rel="noreferrer">
            View on UNIQLO
          </a>
        </div>
        <SizePicker item={item} selection={selection} />
      </div>
    </div>
  );
}

function SlotGroup({ slot }: { slot: Slot }) {
  const catalog = useApp((s) => s.catalog);
  const selection = useApp((s) => s.outfit[slot]);
  const wear = useApp((s) => s.wear);
  const worn = selection ? catalog.find((i) => i.id === selection.itemId) : undefined;
  const others = catalog.filter((i) => i.slot === slot && i.id !== worn?.id);

  return (
    <div className="slot-group">
      {worn && selection && <ProductCard item={worn} selection={selection} />}
      {others.length > 0 && (
        <details className="alternates">
          <summary>
            Other {slot === 'top' ? 'tops' : 'bottoms'} <span className="muted">({others.length})</span>
          </summary>
          <ul aria-label={`Other ${slot === 'top' ? 'tops' : 'bottoms'}`}>
            {others.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => wear(item)}>
                  <span className="alt-name">{item.name}</span>
                  <span className="alt-price">{formatPrice(item)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function OutfitSection({ loadError }: { loadError: string | null }) {
  return (
    <section className="rail-section" aria-labelledby="outfit-title">
      <h2 className="eyebrow" id="outfit-title">
        Outfit
      </h2>
      <PasteLink />
      {loadError && <p className="msg error">{loadError}</p>}
      <SlotGroup slot="top" />
      <SlotGroup slot="bottom" />
    </section>
  );
}
