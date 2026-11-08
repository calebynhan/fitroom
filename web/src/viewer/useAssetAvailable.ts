import { useEffect, useState } from 'react';

export type AssetStatus = 'checking' | 'ok' | 'missing';

/** True only for a real binary/JSON file (Vite dev answers missing paths with index.html). */
export async function assetExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export function useAssetAvailable(url: string): AssetStatus {
  const [status, setStatus] = useState<AssetStatus>('checking');
  useEffect(() => {
    let alive = true;
    setStatus('checking');
    assetExists(url).then((ok) => alive && setStatus(ok ? 'ok' : 'missing'));
    return () => {
      alive = false;
    };
  }, [url]);
  return status;
}
