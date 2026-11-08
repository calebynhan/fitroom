import { useEffect, useState } from 'react';
import { parseFits } from './catalog/fits';
import { parseCatalog } from './catalog/types';
import { usePhoto } from './state/photo';
import { useFit } from './state/store';
import { BodySection } from './ui/BodySection';
import { Header } from './ui/Header';
import { OutfitSection } from './ui/OutfitSection';
import { ResultView } from './ui/ResultView';
import { SceneSection } from './ui/SceneSection';
import { ViewerChrome } from './ui/ViewerChrome';
import { Viewer } from './viewer/Viewer';

const CATALOG_URL = '/catalog.json';
const FITS_URL = '/garments/fits.json';

function useFitsLoader(): void {
  const setFits = useFit((s) => s.setFits);
  useEffect(() => {
    fetch(FITS_URL)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then((data: unknown) => setFits(parseFits(data)))
      .catch((err: unknown) => console.error('[fits] fits.json failed to load', err));
  }, [setFits]);
}

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
        setError('Could not load the bestsellers. Paste a UNIQLO link instead.');
      });
  }, [setCatalog]);
  return error;
}

export function App() {
  const catalogError = useCatalogLoader();
  useFitsLoader();
  const working = usePhoto((s) => s.photo.kind === 'working');

  return (
    <div className="app">
      <Header />
      <main className="stage">
        <div className={`viewer-pane ${working ? 'dimmed' : ''}`}>
          <Viewer />
          <ViewerChrome />
        </div>
        <aside className={`rail ${working ? 'dimmed' : ''}`} aria-label="Controls">
          <BodySection />
          <OutfitSection loadError={catalogError} />
          <SceneSection />
        </aside>
        <ResultView />
      </main>
    </div>
  );
}
