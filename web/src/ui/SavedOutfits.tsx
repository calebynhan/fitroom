import { useState } from 'react';
import type { Selection, Slot } from '../catalog/types';
import { loadOutfit, setOutfitNotice, useOutfitNotice } from '../outfit/load';
import { useSaved, type SavedOutfit } from '../outfit/saved';
import { shareUrl, type SharedOutfit } from '../outfit/share';
import { useApp } from '../state/store';

type Outfit = Partial<Record<Slot, Selection>>;

function current(outfit: Record<Slot, Selection | null>): Outfit {
  return { ...(outfit.top ? { top: outfit.top } : {}), ...(outfit.bottom ? { bottom: outfit.bottom } : {}) };
}

/** Native share sheet where there is one (phones), else the clipboard. Resolves to what to tell the shopper. */
async function share(o: SharedOutfit, title: string): Promise<string | null> {
  const url = shareUrl(o, window.location.origin);
  if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: `FitRoom: ${title}`, url });
      return null;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null; // closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'Link copied. It carries the outfit only, never your photos or measurements.';
  } catch {
    window.prompt('Copy this link:', url);
    return null;
  }
}

function SavedRow({ entry, onShared }: { entry: SavedOutfit; onShared: (text: string) => void }) {
  const remove = useSaved((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const wear = async () => {
    setBusy(true);
    await loadOutfit({ outfit: entry.outfit, scene: entry.scene }, 'saved');
    setBusy(false);
  };
  return (
    <li className="saved-row">
      <span className="saved-name">{entry.name}</span>
      <span className="saved-actions">
        <button type="button" className="link-btn" disabled={busy} onClick={() => void wear()}>
          {busy ? 'Loading…' : 'Wear'}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => void share({ outfit: entry.outfit, scene: entry.scene }, entry.name).then((t) => t && onShared(t))}
          aria-label={`Share ${entry.name}`}
        >
          Share
        </button>
        <button type="button" className="link-btn" onClick={() => remove(entry.id)} aria-label={`Remove ${entry.name}`}>
          Remove
        </button>
      </span>
    </li>
  );
}

/** Save the outfit on screen, share it by link, and wear saved ones again. Photos are never part of either. */
export function SavedOutfits() {
  const outfit = useApp((s) => s.outfit);
  const scene = useApp((s) => s.scene);
  const catalog = useApp((s) => s.catalog);
  const saved = useSaved((s) => s.saved);
  const save = useSaved((s) => s.save);
  const notice = useOutfitNotice((s) => s.notice);
  const [message, setMessage] = useState<string | null>(null);

  const now = current(outfit);
  const name = (['top', 'bottom'] as const)
    .map((slot) => catalog.find((i) => i.id === now[slot]?.itemId)?.name)
    .filter(Boolean)
    .join(' + ');
  const empty = !name;

  const onSave = () => {
    save({ name, outfit: now, scene });
    setOutfitNotice(null);
    setMessage('Saved in this browser (the outfit only; photos are never saved).');
  };

  return (
    <div className="saved">
      <div className="saved-buttons">
        <button type="button" className="btn btn-outline" disabled={empty} onClick={onSave}>
          Save outfit
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={empty}
          onClick={() => {
            setOutfitNotice(null);
            void share({ outfit: now, scene }, name).then((t) => setMessage(t));
          }}
        >
          Share link
        </button>
      </div>
      <p className="size-note" role="status">
        {notice ? <span className={notice.kind === 'error' ? 'warn' : ''}>{notice.text}</span> : message}
      </p>
      {saved.length > 0 && (
        <details className="saved-list" open>
          <summary className="eyebrow">Saved outfits ({saved.length})</summary>
          <ul>
            {saved.map((entry) => (
              <SavedRow key={entry.id} entry={entry} onShared={setMessage} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
