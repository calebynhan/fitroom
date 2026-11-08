import { useState } from 'react';
import { fitFor } from '../catalog/fits';
import { findColor, formatPrice, type CatalogItem, type Slot } from '../catalog/types';
import { useFit } from '../state/store';
import { PasteLink } from './PasteLink';

/** UNIQLO product shots follow usgoods_<colour>_<num>_3x4.jpg; fall back to the default shot on error. */
function colorImage(image: string | undefined, code: string): string | undefined {
  return image?.replace(/usgoods_\d{2}_/, `usgoods_${code}_`);
}

function Thumb({ item, code, slot }: { item: CatalogItem; code: string; slot: Slot }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = failed === code ? item.image : colorImage(item.image, code);
  return (
    <div className="thumb">
      {src ? <img src={src} alt="" loading="lazy" onError={() => setFailed(code)} /> : <span>{slot}</span>}
    </div>
  );
}

function ProductCard({ item, colorCode }: { item: CatalogItem; colorCode: string }) {
  const setColor = useFit((s) => s.setColor);
  const fitLabel = useFit((s) => fitFor(s.fits, item.id, item.name).label);
  const color = findColor(item, colorCode);
  return (
    <div className="product">
      <Thumb item={item} code={color.code} slot={item.slot} />
      <div className="product-body">
        <div className="product-meta">
          <span>{item.slot}</span>
          <span>{color.name}</span>
        </div>
        <div className="product-name">{item.name}</div>
        <div className="product-price">
          {item.salePrice !== null && <s>${item.price.toFixed(2)}</s>} {formatPrice(item)}
          {fitLabel && <span className="product-fit"> · {fitLabel}</span>}
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
      </div>
    </div>
  );
}

function SlotGroup({ slot }: { slot: Slot }) {
  const catalog = useFit((s) => s.catalog);
  const selection = useFit((s) => s.outfit[slot]);
  const wear = useFit((s) => s.wear);
  const worn = selection ? catalog.find((i) => i.id === selection.itemId) : undefined;
  const others = catalog.filter((i) => i.slot === slot && i.id !== worn?.id);

  return (
    <div className="slot-group">
      {worn && selection && <ProductCard item={worn} colorCode={selection.colorCode} />}
      {others.length > 0 && (
        <ul className="alternates" aria-label={`Other ${slot}s`}>
          {others.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => wear(item)}>
                <span className="alt-name">{item.name}</span>
                <span className="alt-price">{formatPrice(item)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OutfitSection({ loadError }: { loadError: string | null }) {
  return (
    <section className="rail-section">
      <h2 className="eyebrow">Outfit</h2>
      <PasteLink />
      {loadError && <p className="msg error">{loadError}</p>}
      <SlotGroup slot="top" />
      <SlotGroup slot="bottom" />
    </section>
  );
}
