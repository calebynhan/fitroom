import { findColor, formatPrice, formatSizes, type CatalogItem, type Slot } from '../catalog/types';
import { useFit } from '../state/store';
import { PasteLink } from './PasteLink';

const SLOT_LABEL: Record<Slot, string> = { top: 'Top', bottom: 'Bottom' };

interface ItemCardProps {
  item: CatalogItem;
  worn: boolean;
  colorCode: string | null;
}

function ItemCard({ item, worn, colorCode }: ItemCardProps) {
  const wear = useFit((s) => s.wear);
  const setColor = useFit((s) => s.setColor);
  const color = colorCode ? findColor(item, colorCode) : null;

  return (
    <li className={`item ${worn ? 'worn' : ''}`}>
      <button type="button" className="item-head" onClick={() => wear(item, worn ? colorCode ?? undefined : undefined)}>
        <span className="item-name">{item.name}</span>
        <span className="item-meta">
          {item.salePrice !== null && <s>${item.price.toFixed(2)}</s>} {formatPrice(item)} · {formatSizes(item.sizes)}
        </span>
      </button>
      {worn && (
        <div className="swatches" role="radiogroup" aria-label={`${item.name} colour`}>
          {item.colors.map((c) => (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={c.code === colorCode}
              className={`swatch ${c.code === colorCode ? 'active' : ''}`}
              style={{ backgroundColor: c.hex }}
              title={c.name}
              onClick={() => setColor(item.slot, c.code)}
            />
          ))}
          {color && <span className="swatch-name">{color.name}</span>}
          <a className="item-link" href={item.url} target="_blank" rel="noreferrer">
            View on UNIQLO ↗
          </a>
        </div>
      )}
    </li>
  );
}

function SlotSection({ slot }: { slot: Slot }) {
  const catalog = useFit((s) => s.catalog);
  const selection = useFit((s) => s.outfit[slot]);
  const takeOff = useFit((s) => s.takeOff);
  const items = catalog.filter((i) => i.slot === slot);

  return (
    <section className="slot">
      <div className="slot-head">
        <h3>{SLOT_LABEL[slot]}</h3>
        {selection && (
          <button type="button" className="link" onClick={() => takeOff(slot)}>
            take off
          </button>
        )}
      </div>
      <ul className="items">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            worn={selection?.itemId === item.id}
            colorCode={selection?.itemId === item.id ? selection.colorCode : null}
          />
        ))}
      </ul>
    </section>
  );
}

export function OutfitPanel({ loadError }: { loadError: string | null }) {
  return (
    <aside className="panel outfit-panel" aria-label="Outfit">
      <h2>Outfit</h2>
      <PasteLink />
      {loadError && <p className="error">{loadError}</p>}
      <SlotSection slot="top" />
      <SlotSection slot="bottom" />
    </aside>
  );
}
