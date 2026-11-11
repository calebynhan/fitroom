import { useState } from 'react';
import { fitPrefs, sizingBody } from '../body/profile';
import { colorImage, colorLabel, findColor, formatMoney, formatPrice, type CatalogItem, type Selection, type Slot } from '../catalog/types';
import { fitCard } from '../fit/fitCard';
import { chartSizes, easeFor, fitSummary, formatSize, lengthFor, shortSize, sizeAdvice, sizePair } from '../fit/sizing';
import { useApp } from '../state/store';
import { FitTable } from './FitTable';
import { MeasureLink } from './measureLink';
import { PasteLink } from './PasteLink';
import { SavedOutfits } from './SavedOutfits';
import { onRadioKeys, rovingTab } from './radioKeys';

const CUT_LABEL: Record<CatalogItem['fit'], string> = { slim: 'Slim cut', regular: 'Regular cut', relaxed: 'Relaxed cut' };

function Thumb({ item, code, slot }: { item: CatalogItem; code: string; slot: Slot }) {
  const [failures, setFailures] = useState<{ code: string; count: number }>({ code, count: 0 });
  const count = failures.code === code ? failures.count : 0;
  // This colour's shot, then the default shot, then a plain tile.
  const sources = [findColor(item, code).image ?? colorImage(item.image, code), item.image].filter(Boolean);
  const src = sources[count];
  return (
    <div className="thumb">
      {src ? <img src={src} alt="" width={64} height={85} loading="lazy" onError={() => setFailures({ code, count: count + 1 })} /> : <span>{slot}</span>}
    </div>
  );
}

function SizePicker({ item, selection }: { item: CatalogItem; selection: Selection }) {
  const profile = useApp((s) => s.profile);
  const setSize = useApp((s) => s.setSize);
  const body = sizingBody(profile);
  const prefs = fitPrefs(profile)[item.slot];
  const sizes = chartSizes(item);
  const advice = body ? sizeAdvice(item, body, prefs) : null;
  const chosen = selection.size ?? advice?.size;
  const summary = body && chosen ? fitSummary(easeFor(item, chosen, body), lengthFor(item, chosen, body)) : null;
  const pair = sizePair(selection.size, advice);
  const card = body && pair ? fitCard(item, pair.compare ? [pair.size, pair.compare] : [pair.size], body, profile.units, prefs) : null;

  if (sizes.length === 0) return <p className="size-note">No size chart for this item, so the shots show your usual size.</p>;
  return (
    <div className="sizes">
      <div className="size-chips" role="radiogroup" aria-label={`${item.name} size`} onKeyDown={onRadioKeys}>
        {sizes.map((s, i) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === chosen}
            tabIndex={rovingTab(s === chosen, i, chosen !== undefined && sizes.includes(chosen))}
            className={`size-chip ${s === chosen ? 'active' : ''} ${s === advice?.size ? 'yours' : ''}`}
            title={s === advice?.size ? 'Your size' : undefined}
            onClick={() => setSize(item.slot, s === advice?.size ? undefined : s)}
          >
            {shortSize(s)}
            {s === advice?.size && <span className="sr-only"> (your size)</span>}
          </button>
        ))}
      </div>
      <p className={`size-note ${advice && !advice.fits ? 'warn' : ''}`}>
        {advice ? advice.text : 'Add your height and weight to get your size.'}
        {summary && chosen && (
          <>
            {' '}
            <span className="size-fit">
              {formatSize(chosen)}: {summary.charAt(0).toLowerCase() + summary.slice(1)}.
            </span>
          </>
        )}
        {advice?.borderline && (
          <>
            {' '}
            <MeasureLink borderline={advice.borderline} />
          </>
        )}
      </p>
      {card && <FitTable card={card} caption={`${item.name}: how ${card.sizes.join(' and ')} fit you`} />}
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
          <span>{colorLabel(item, color.code)}</span>
        </div>
        <div className="product-name" translate="no">
          {item.name}
        </div>
        <div className="product-price">
          {item.salePrice !== null && <s>{formatMoney(item.price)}</s>} {formatPrice(item)}
          <span className="product-fit"> · {CUT_LABEL[item.fit] ?? 'Regular cut'}</span>
        </div>
        <div className="product-foot">
          <div className="swatches" role="radiogroup" aria-label={`${item.name} colour`} onKeyDown={onRadioKeys}>
            {item.colors.map((c, i) => (
              <button
                key={c.code}
                type="button"
                role="radio"
                aria-checked={c.code === color.code}
                aria-label={colorLabel(item, c.code)}
                tabIndex={rovingTab(c.code === color.code, i, true)}
                title={colorLabel(item, c.code)}
                className={`swatch ${c.code === color.code ? 'active' : ''}`}
                onClick={() => setColor(item.slot, c.code)}
              >
                <span style={{ background: c.hex }} aria-hidden />
              </button>
            ))}
          </div>
          <a className="uniqlo-link" href={item.url} target="_blank" rel="noreferrer">
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
                  <span className="alt-name" translate="no">
                    {item.name}
                  </span>
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
    <section className="rail-section" id="outfit" aria-labelledby="outfit-title">
      <h2 className="eyebrow" id="outfit-title">
        Outfit
      </h2>
      <PasteLink />
      {loadError && <p className="msg error">{loadError}</p>}
      <SlotGroup slot="top" />
      <SlotGroup slot="bottom" />
      <SavedOutfits />
    </section>
  );
}
