// Dev-only try-on eval page (web/eval.html). Runs the shopper pipeline on a fixed garment set and scores each result
// with eval/metrics.ts, so changes to the try-on (garment photos, parameters, compositing, another Space) can be
// compared with numbers instead of by eye. Not part of the production build (vite builds index.html only).
import catalog from '../../public/catalog.json';
import { parseCatalog, productImage, type CatalogItem } from '../catalog/types';
import { bodyOf } from '../photos/body';
import { preparePhoto } from '../photos/prepare';
import { skinColouredHex } from '../tryon/composite';
import { loadGarmentPhoto } from '../tryon/garment';
import { dressPass } from '../tryon/pass';
import { garmentUrl, runSpace, SpaceError } from '../tryon/space';
import { flags, scoreTryOn, type TryOnScores } from './metrics';

/** The fixed set: flat and worn product photos, light and dark, tops and tall flat pants. */
const GARMENTS: { id: string; color: string; why: string }[] = [
  { id: 'E453754-000', color: '67', why: 'sweater, garment-only photo' },
  { id: 'E422992-000', color: '38', why: 'tee, product photo is a model shot' },
  { id: 'E455365-000', color: '00', why: 'light tee (white-ish)' },
  { id: 'E475598-000', color: '09', why: 'black pants, garment-only' },
  { id: 'E482868-000', color: '', why: 'jeans, garment-only' },
  { id: 'E471809-000', color: '', why: 'tall flat pants (detector edge case)' },
];
const FABRIC: Record<'top' | 'bottom', [number, number, number, number]> = { top: [0.35, 0.4, 0.65, 0.6], bottom: [0.42, 0.45, 0.58, 0.65] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s: string) => {
  $('log').textContent += `${s}\n`;
  $('log').scrollTop = 1e9;
};
const items = parseCatalog(catalog);
const results: {
  person: string;
  garment: string;
  framing: string;
  type?: string;
  box?: string;
  seconds?: number;
  scores?: TryOnScores;
  flags?: string[];
  error?: string;
}[] = [];
/** Scores are computed on the finished photo drawn at this width (the same for both framings, so detail compares). */
const SCORE_W = 576;

async function pixels(src: Blob | string, w: number, h: number): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h).data;
}

function cell(html: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.innerHTML = html;
  td.style.cssText = 'padding:4px 8px;border-top:1px solid #e4dfd6;vertical-align:top';
  return td;
}

async function run(): Promise<void> {
  const files = [...($<HTMLInputElement>('people').files ?? [])];
  if (!files.length) return log('Pick at least one photo.');
  $<HTMLButtonElement>('run').disabled = true;
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;font-size:12px';
  table.innerHTML =
    '<tr><th>person</th><th>garment</th><th>result</th><th>changed</th><th>above garment</th><th>colour dE</th><th>lightness</th><th>detail</th><th>flags</th></tr>';
  $('out').replaceChildren(table);
  const crop = $<HTMLSelectElement>('framing').value === 'crop';
  const framing = crop ? 'crop (app)' : 'whole photo';
  outer: for (const file of files) {
    const person = await preparePhoto(file, 'front');
    const body = crop ? await bodyOf(person.dataUrl) : null;
    if (crop && !body) log(`${file.name}: no body found, so the whole photo is sent`);
    for (const g of GARMENTS) {
      const item = items.find((i) => i.id === g.id) as CatalogItem | undefined;
      if (!item) continue;
      const code = g.color && item.colors.some((c) => c.code === g.color) ? g.color : item.colors[0].code;
      const label = `${item.name} (${code}): ${g.why}`;
      const row: (typeof results)[number] = { person: file.name, garment: label, framing };
      results.push(row);
      try {
        // the colour reference is UNIQLO's photo as framed (FABRIC is a box on it), not the cropped copy sent
        const unframed = await loadGarmentPhoto(garmentUrl(productImage(item, code)!), { frame: false });
        const photo = crop ? await loadGarmentPhoto(garmentUrl(productImage(item, code)!)) : unframed;
        if (!photo || !unframed) throw new Error('no product photo');
        row.type = photo.type;
        const t0 = performance.now();
        log(`${file.name} x ${label} (${photo.type}, ${framing})...`);
        const hex = item.colors.find((c) => c.code === code)?.hex;
        const category = item.slot === 'top' ? 'tops' : 'bottoms';
        const pass = { blob: photo.blob, type: photo.type, category, skinTone: skinColouredHex(hex) } as const;
        const { image: shown, box } = await dressPass(person.dataUrl, person.dataUrl, body, pass, runSpace, () => undefined);
        row.box = box ? `${box.w}x${box.h} at ${box.x},${box.y}` : 'whole photo';
        row.seconds = Math.round((performance.now() - t0) / 100) / 10;
        const [w, h] = [SCORE_W, Math.round((SCORE_W * person.height) / person.width)];
        const prodBmp = await createImageBitmap(unframed.blob);
        const [pw, ph] = [150, Math.round((150 * prodBmp.height) / prodBmp.width)];
        prodBmp.close();
        row.scores = scoreTryOn(await pixels(person.dataUrl, w, h), await pixels(shown, w, h), w, h, {
          px: await pixels(unframed.blob, pw, ph),
          width: pw,
          height: ph,
          fabric: FABRIC[item.slot],
        });
        row.flags = flags(row.scores);
        const s = row.scores;
        const tr = document.createElement('tr');
        tr.append(
          cell(`<img src="${person.dataUrl}" height="180">`),
          cell(`<img src="${URL.createObjectURL(photo.blob)}" height="180"><br>${label}<br>${photo.type}`),
          cell(`<img src="${shown}" height="180"><br>${row.seconds} s<br>${row.box}`),
          cell(`${(100 * s.changed).toFixed(1)}%`),
          cell(s.aboveGarment?.toFixed(1) ?? '-'),
          cell(s.colourDE?.toFixed(1) ?? '-'),
          cell(s.lightnessD?.toFixed(1) ?? '-'),
          cell(s.detail?.toFixed(2) ?? '-'),
          cell(row.flags.join('<br>') || 'ok'),
        );
        table.append(tr);
      } catch (err: unknown) {
        row.error = err instanceof Error ? err.message : String(err);
        log(`  failed: ${row.error}`);
        if (err instanceof SpaceError && err.quota) {
          log('Free GPU time is used up: stopping. The partial results above are kept.');
          break outer;
        }
      }
    }
  }
  $<HTMLButtonElement>('run').disabled = false;
  $<HTMLButtonElement>('json').disabled = results.length === 0;
  log('Done.');
}

$('run').addEventListener('click', () => void run());
$('json').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), results }, null, 1)], { type: 'application/json' }));
  a.download = `fitroom-tryon-eval-${Date.now()}.json`;
  a.click();
});
