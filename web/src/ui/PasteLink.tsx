import { parseProductId, toCatalogItem, type UniqloDetails } from '@api/uniqlo';
import { useState, type FormEvent } from 'react';
import type { CatalogItem } from '../catalog/types';
import { useFit } from '../state/store';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string; blocked: boolean };

// Run on a uniqlo.com product page (same-origin there): copies the product JSON to the clipboard.
const CONSOLE_SNIPPET =
  "fetch(location.pathname.replace(/.*products\\/(E\\d{6}-\\d{3}).*/,'/us/api/commerce/v5/en/products/$1/price-groups/00/details?includeModelSize=false&httpFailure=true')).then(r=>r.text()).then(t=>copy(t))";

async function fetchProduct(url: string): Promise<CatalogItem | { error: string; code?: string }> {
  try {
    const res = await fetch('/api/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as CatalogItem | { error: string; code?: string };
    return data;
  } catch {
    return { error: 'Could not reach the server.', code: 'blocked' };
  }
}

function itemFromPastedJson(text: string, link: string): CatalogItem | string {
  try {
    const parsed = JSON.parse(text) as { result?: UniqloDetails & { productId?: string } };
    const result = parsed.result;
    const id = parseProductId(link) ?? (result?.productId ? parseProductId(result.productId) : null);
    if (!result || !id) return 'That does not look like UNIQLO product JSON.';
    const out = toCatalogItem(id, result);
    return 'item' in out ? out.item : out.error;
  } catch {
    return 'That is not valid JSON. Run the snippet again and paste the whole thing.';
  }
}

export function PasteLink() {
  const addItem = useFit((s) => s.addItem);
  const wear = useFit((s) => s.wear);
  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const accept = (item: CatalogItem) => {
    const linkColor = link.match(/colorDisplayCode=(\d{2})/)?.[1];
    addItem(item);
    wear(item, item.colors.some((c) => c.code === linkColor) ? linkColor : undefined);
    setLink('');
    setPasted('');
    setStatus({ kind: 'idle' });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parseProductId(link)) {
      setStatus({ kind: 'error', message: 'Paste a product link like uniqlo.com/us/en/products/E453754-000/00', blocked: false });
      return;
    }
    setStatus({ kind: 'loading' });
    const result = await fetchProduct(link);
    if ('id' in result) accept(result);
    else setStatus({ kind: 'error', message: result.error, blocked: result.code === 'blocked' });
  };

  const onPasteJson = () => {
    const result = itemFromPastedJson(pasted, link);
    if (typeof result === 'string') setStatus({ kind: 'error', message: result, blocked: true });
    else accept(result);
  };

  return (
    <div className="paste">
      <form onSubmit={onSubmit} className="paste-row">
        <input
          type="url"
          inputMode="url"
          placeholder="Paste a UNIQLO link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          aria-label="UNIQLO product link"
        />
        <button type="submit" disabled={status.kind === 'loading' || link.trim() === ''}>
          {status.kind === 'loading' ? '…' : 'Try on'}
        </button>
      </form>
      {status.kind === 'error' && <p className="error">{status.message}</p>}
      {status.kind === 'error' && status.blocked && (
        <details className="fallback" open>
          <summary>Paste product JSON instead</summary>
          <ol>
            <li>Open the product page on uniqlo.com.</li>
            <li>
              Open the browser console and run:
              <code className="snippet" onClick={() => navigator.clipboard?.writeText(CONSOLE_SNIPPET)} title="Click to copy">
                {CONSOLE_SNIPPET}
              </code>
            </li>
            <li>Paste the copied JSON here:</li>
          </ol>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} placeholder='{"status":"ok","result":{…}}' />
          <button type="button" onClick={onPasteJson} disabled={pasted.trim() === ''}>
            Add item
          </button>
        </details>
      )}
    </div>
  );
}
