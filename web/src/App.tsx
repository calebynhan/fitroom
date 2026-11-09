import { useEffect, useState } from 'react';
import { parseCatalog } from './catalog/types';
import { useApp } from './state/store';
import { Header } from './ui/Header';
import { Lookbook } from './ui/Lookbook';
import { MeasureSection } from './ui/MeasureSection';
import { OutfitSection } from './ui/OutfitSection';
import { PhotoSection } from './ui/PhotoSection';
import { SceneSection } from './ui/SceneSection';

const CATALOG_URL = '/catalog.json';

function useCatalogLoader(): string | null {
  const setCatalog = useApp((s) => s.setCatalog);
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
        setError('Could not load the bestsellers. Paste a UNIQLO link instead.');
      });
  }, [setCatalog]);
  return error;
}

export function App() {
  const catalogError = useCatalogLoader();
  return (
    <div className="app">
      <Header />
      <main className="stage">
        <section className="lookbook-pane" aria-label="Your photos">
          <Lookbook />
        </section>
        <aside className="rail" aria-label="Controls">
          <PhotoSection />
          <MeasureSection />
          <OutfitSection loadError={catalogError} />
          <SceneSection />
        </aside>
      </main>
    </div>
  );
}
