import { useEffect, useState } from 'react';

export type AssetStatus = 'checking' | 'ok' | 'missing';

// Remember positive answers so remounts (e.g. swapping garments) don't blink while re-probing.
const known = new Set<string>();

/** True only for a real binary/JSON file (Vite dev answers missing paths with index.html). */
export async function assetExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** Checks an asset once and remembers it, so later mounts skip the probe. */
export async function primeAsset(url: string): Promise<boolean> {
  if (known.has(url)) return true;
  const ok = await assetExists(url);
  if (ok) known.add(url);
  return ok;
}

export function useAssetAvailable(url: string): AssetStatus {
  const [status, setStatus] = useState<AssetStatus>(known.has(url) ? 'ok' : 'checking');
  useEffect(() => {
    if (known.has(url)) {
      setStatus('ok');
      return undefined;
    }
    let alive = true;
    setStatus('checking');
    assetExists(url).then((ok) => {
      if (ok) known.add(url);
      if (alive) setStatus(ok ? 'ok' : 'missing');
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return status;
}
