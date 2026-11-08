import { useEffect, useState } from 'react';
import { parseCatalog } from './catalog/types';
import { useFit } from './state/store';
import { BodyPanel } from './ui/BodyPanel';
import { OutfitPanel } from './ui/OutfitPanel';
import { SceneBar } from './ui/SceneBar';
import { Viewer } from './viewer/Viewer';

const CATALOG_URL = '/catalog.json';

function useCatalogLoader(): string | null {
  const setCatalog = useFit((s) => s.setCatalog);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(CATALOG_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: unknown) => {
        const items = parseCatalog(data);
        if (items.length === 0) throw new Error('catalog is empty');
        setCatalog(items);
      })
      .catch((err: unknown) => {
        console.error('[catalog] failed to load', err);
        setError('Could not load the product catalog. Paste a UNIQLO link instead.');
      });
  }, [setCatalog]);
  return error;
}

export function App() {
  const catalogError = useCatalogLoader();
  return (
    <div className="app">
      <Viewer />
      <header className="brand">
        <span className="brand-mark">FitRoom</span>
        <span className="brand-sub">try UNIQLO on your body</span>
      </header>
      <BodyPanel />
      <OutfitPanel loadError={catalogError} />
      <SceneBar />
    </div>
  );
}
