import { useEffect, useState } from 'react';
import { TRY_ON } from './look/engine';
import { parseCatalog } from './catalog/types';
import { loadOutfitFromUrl } from './outfit/load';
import { hasUnsavedPhotos, useLooks } from './state/looks';
import { useApp } from './state/store';
import { Header } from './ui/Header';
import { Lookbook } from './ui/Lookbook';
import { FitSection, MeasureSection } from './ui/MeasureSection';
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
      })
      .finally(() => void loadOutfitFromUrl()); // a shared link's items are fetched even without the catalog
  }, [setCatalog]);
  return error;
}

/** Photos live only in this tab (never stored), so warn before a reload or close throws them away. */
function useLeaveWarning(): void {
  const unsaved = useLooks(hasUnsavedPhotos);
  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // older browsers need this to show the prompt
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
}

export function App() {
  const catalogError = useCatalogLoader();
  useLeaveWarning();
  return (
    <div className="app">
      <a className="skip-link" href="#you">
        Skip to your photos and measurements
      </a>
      <Header />
      <main className="stage">
        <section className="lookbook-pane" aria-label="Your photos">
          <Lookbook />
        </section>
        <aside className="rail" aria-label="Controls">
          <PhotoSection />
          <MeasureSection />
          <FitSection />
          <OutfitSection loadError={catalogError} />
          {!TRY_ON && <SceneSection />}
        </aside>
      </main>
    </div>
  );
}
