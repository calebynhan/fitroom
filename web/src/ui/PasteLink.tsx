import { parseProductId, toCatalogItem, type UniqloDetails } from '@api/uniqlo';
import { useState, type ClipboardEvent, type FormEvent } from 'react';
import { fetchProduct } from '../catalog/fetchProduct';
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <button type="button" className="link-btn copy-btn" onClick={() => void copy()} aria-live="polite">
      {copied === null ? 'Copy snippet' : copied ? 'Copied' : 'Copy failed: select and copy it by hand'}
    </button>
  );
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
          name="productUrl"
          autoComplete="off"
          spellCheck={false}
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
              <code className="snippet" translate="no">
                {CONSOLE_SNIPPET}
              </code>
              <CopyButton text={CONSOLE_SNIPPET} />
            </li>
            <li>Paste the copied JSON here:</li>
          </ol>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={3}
            name="productJson"
            spellCheck={false}
            aria-label="UNIQLO product JSON"
            placeholder='{"status":"ok","result":{…}}'
          />
          <button type="button" className="btn btn-dark" onClick={onPasteJson} disabled={pasted.trim() === ''}>
            Add Item
          </button>
        </details>
      )}
    </div>
  );
}
