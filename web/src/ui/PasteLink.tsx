import { parseProductId, toCatalogItem, type UniqloDetails } from '@api/uniqlo';
import { useState, type ClipboardEvent, type FormEvent } from 'react';
import type { CatalogItem } from '../catalog/types';
import { useApp } from '../state/store';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'added'; name: string }
  | { kind: 'error'; message: string; blocked: boolean };

// Run on a uniqlo.com product page (same-origin there): copies the product JSON to the clipboard.
const CONSOLE_SNIPPET =
  "fetch(location.pathname.replace(/.*products\\/(E\\d{6}-\\d{3}).*/,'/us/api/commerce/v5/en/products/$1/price-groups/00/details?includeModelSize=false&httpFailure=true')).then(r=>r.text()).then(t=>copy(t))";

type ProductResponse = CatalogItem | { error: string; code?: string };

async function fetchProduct(url: string): Promise<ProductResponse> {
  try {
    const res = await fetch('/api/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return (await res.json()) as ProductResponse;
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

function statusText(status: Status): string {
  switch (status.kind) {
    case 'loading':
      return 'Fetching from UNIQLO…';
    case 'added':
      return `Added ${status.name} — now wearing`;
    case 'error':
      return status.message;
    default:
      return 'T-shirts, sweaters and pants from uniqlo.com/us';
  }
}

export function PasteLink() {
  const addItem = useApp((s) => s.addItem);
  const wear = useApp((s) => s.wear);
  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const accept = (item: CatalogItem, source: string) => {
    const linkColor = source.match(/colorDisplayCode=(\d{2})/)?.[1];
    addItem(item);
    wear(item, item.colors.some((c) => c.code === linkColor) ? linkColor : undefined);
    setLink('');
    setPasted('');
    setStatus({ kind: 'added', name: item.name });
  };

  const submit = async (value: string) => {
    if (!parseProductId(value)) {
      setStatus({ kind: 'error', message: 'Paste a UNIQLO product link, e.g. uniqlo.com/us/en/products/E453754-000', blocked: false });
      return;
    }
    setStatus({ kind: 'loading' });
    const result = await fetchProduct(value);
    if ('id' in result) accept(result, value);
    else setStatus({ kind: 'error', message: result.error, blocked: result.code === 'blocked' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(link);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!parseProductId(text)) return; // let the browser paste normally
    e.preventDefault();
    setLink(text);
    void submit(text);
  };

  const onPasteJson = () => {
    const result = itemFromPastedJson(pasted, link);
    if (typeof result === 'string') setStatus({ kind: 'error', message: result, blocked: true });
    else accept(result, link);
  };

  return (
    <div className="paste">
      <form onSubmit={onSubmit}>
        <input
          type="text"
          inputMode="url"
          className="paste-input"
          placeholder="Paste a UNIQLO link, e.g. uniqlo.com/us/en/products/E453754-000…"
          value={link}
          disabled={status.kind === 'loading'}
          onChange={(e) => setLink(e.target.value)}
          onPaste={onPaste}
          aria-label="UNIQLO product link"
        />
      </form>
      <p className={`msg ${status.kind === 'error' ? 'error' : ''}`} aria-live="polite">
        {statusText(status)}
      </p>
      {status.kind === 'error' && status.blocked && (
        <details className="fallback" open>
          <summary>Paste the product JSON instead</summary>
          <ol>
            <li>Open the product page on uniqlo.com.</li>
            <li>
              In the browser console, run:
              <code className="snippet" onClick={() => navigator.clipboard?.writeText(CONSOLE_SNIPPET)} title="Click to copy">
                {CONSOLE_SNIPPET}
              </code>
            </li>
            <li>Paste the copied JSON here:</li>
          </ol>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} placeholder='{"status":"ok","result":{…}}' />
          <button type="button" className="btn btn-dark" onClick={onPasteJson} disabled={pasted.trim() === ''}>
            ADD ITEM
          </button>
        </details>
      )}
    </div>
  );
}
