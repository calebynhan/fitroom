// Builds web/public/catalog.json from UNIQLO US's public commerce API (listing -> details -> size charts ->
// swatch colours). Run from the repo root:  npm run catalog  [-- --per-shape 12 --out <file> --dry-run]
// Exits non-zero (and leaves the old file alone) if fewer than MIN_ITEMS valid items come back.
import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sampleChipHex } from '../api/_lib/chipColor.ts';
import { parseSizeChart, type SizeChart } from '../api/_lib/sizeChart.ts';
import { fallbackHex, swatchUrl, toCatalogItem, type CatalogItem, type Shape, type UniqloDetails } from '../api/_lib/uniqlo.ts';
import { fetchDetails, fetchListing, fetchSizeCharts } from '../api/_lib/uniqloClient.ts';
import { mapLimit, pickCandidates, selectGroup, validateCatalogItem } from './catalog/select.ts';

// Category paths are "gender,class,category,subcategory" IDs from the listing API's aggregations.tree
// (Men 22211; T-Shirts, Sweats & Fleece 23305 > T-Shirts 23386; Sweaters & Knitwear 95668 > Sweaters &
// Cardigans 95670; Bottoms 23306). Heroes are the items named in CLAUDE.md; they are always included.
// Selection is per final shape: long-sleeve tees from the T-shirt listing land on the sweater mesh.
const GROUPS = [
  { key: 'tees', path: '22211,23305,23386,', heroes: ['E455365-000', 'E422992-000'] },
  { key: 'sweaters', path: '22211,95668,95670,', heroes: ['E453754-000', 'E450543-000'] },
  { key: 'pants', path: '22211,23306,,', heroes: ['E475598-000', 'E450251-000'] },
];
const HEROES = GROUPS.flatMap((g) => g.heroes);
const SHAPES: Shape[] = ['tee', 'sweater', 'pants'];
const MIN_ITEMS = 30;
const DEFAULT_PER_SHAPE = 12;
const CANDIDATES_PER_GROUP = 30; // enough to fill each shape after unsupported items and duplicates drop out
const DETAILS_CONCURRENCY = 3;
const SWATCH_CONCURRENCY = 6;
const NET = { timeoutMs: 12_000, retries: 2, retryDelayMs: 800 };
const DEFAULT_OUT = 'web/public/catalog.json';

interface Report {
  notes: string[];
  problems: string[];
  unknownSizeParts: Set<string>;
  swatchFallbacks: number;
}

interface Fetched {
  id: string;
  raw: UniqloDetails;
}

interface Picked extends Fetched {
  item: CatalogItem;
  chart: SizeChart | null;
}

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function parseCli(): { perShape: number; out: string; dryRun: boolean } {
  const { values } = parseArgs({
    options: {
      'per-shape': { type: 'string', default: String(DEFAULT_PER_SHAPE) },
      out: { type: 'string', default: DEFAULT_OUT },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const perShape = Number(values['per-shape']);
  if (!Number.isInteger(perShape) || perShape < 1 || perShape > 30) throw new Error('--per-shape must be 1-30');
  return { perShape, out: resolve(values.out ?? DEFAULT_OUT), dryRun: values['dry-run'] ?? false };
}

/** Details for the best candidates of one listing category. */
async function fetchGroup(group: (typeof GROUPS)[number], report: Report): Promise<Fetched[]> {
  const listing = await fetchListing(group.path, NET);
  if (!listing.ok) throw new Error(`${group.key}: listing failed (${listing.status} ${listing.reason})`);
  const ids = pickCandidates(listing.data, { heroes: group.heroes, limit: CANDIDATES_PER_GROUP });

  const details = await mapLimit(ids, DETAILS_CONCURRENCY, (id) => fetchDetails(id, NET));
  const fetched = ids.flatMap((id, i): Fetched[] => {
    const res = details[i];
    if (res.ok) return [{ id, raw: res.data }];
    report.problems.push(`${id}: details failed (${res.status} ${res.reason})`);
    return [];
  });
  log(`${group.key}: ${listing.data.length} listed, ${fetched.length}/${ids.length} fetched`);
  return fetched;
}

/** Maps every fetched product with its size chart (which can decide tee vs sweater); drops unsupported ones. */
function mapAll(pool: Fetched[], charts: Map<string, SizeChart | null>, report: Report): Picked[] {
  return pool.flatMap(({ id, raw }): Picked[] => {
    const chart = charts.get(id) ?? null; // toCatalogItem trims it to the sizes the item sells
    const out = toCatalogItem(id, raw, fallbackHex, chart);
    if ('error' in out) {
      report.notes.push(`skipped ${id}: ${out.error}`);
      return [];
    }
    return [{ id, raw, chart, item: out.item }];
  });
}

/** Per shape: heroes, then the most-reviewed items, without same-name duplicates. */
function choose(mapped: Picked[], perShape: number, report: Report): Picked[] {
  const ranked = [...mapped].sort((a, b) => (b.raw.rating?.count ?? 0) - (a.raw.rating?.count ?? 0));
  HEROES.filter((h) => !mapped.some((p) => p.id === h)).forEach((h) => report.problems.push(`hero ${h} is missing`));
  return SHAPES.flatMap((shape) => {
    const chosen = selectGroup(
      ranked.filter((p) => p.item.shape === shape).map((p) => p.item),
      { heroes: HEROES, target: perShape },
    );
    if (chosen.length < perShape) report.notes.push(`only ${chosen.length} ${shape} items available`);
    return chosen.map((item) => ranked.find((p) => p.item.id === item.id) as Picked);
  });
}

async function loadCharts(ids: string[], report: Report): Promise<Map<string, SizeChart | null>> {
  const res = await fetchSizeCharts(ids, NET);
  if (!res.ok) {
    report.problems.push(`size charts failed (${res.status} ${res.reason}); every sizeChart is null`);
    return new Map();
  }
  return new Map(
    ids.map((id) => {
      const parsed = parseSizeChart(res.data.get(id));
      parsed.unknownParts.forEach((p) => report.unknownSizeParts.add(p));
      return [id, parsed.chart] as const;
    }),
  );
}

async function sampleHexes(picked: Picked[], report: Report): Promise<Map<string, string>> {
  const jobs = picked.flatMap(({ item }) => item.colors.map((c) => ({ id: item.id, code: c.code })));
  const hexes = await mapLimit(jobs, SWATCH_CONCURRENCY, async ({ id, code }) => {
    const sampled = await sampleChipHex(swatchUrl(id, code));
    if (!sampled) report.swatchFallbacks += 1;
    return sampled ?? fallbackHex(code);
  });
  return new Map(jobs.map((job, i) => [`${job.id}:${job.code}`, hexes[i]] as const));
}

function finalize(picked: Picked[], hexes: Map<string, string>, report: Report): CatalogItem[] {
  return picked.flatMap(({ id, raw, chart }) => {
    const out = toCatalogItem(id, raw, (code) => hexes.get(`${id}:${code}`) ?? fallbackHex(code), chart);
    if ('error' in out) {
      report.problems.push(`${id}: ${out.error}`);
      return [];
    }
    const problems = validateCatalogItem(out.item);
    if (problems.length > 0) {
      report.problems.push(`dropped ${id} (${out.item.name}): ${problems.join('; ')}`);
      return [];
    }
    return [out.item];
  });
}

function countBy(items: CatalogItem[], key: (i: CatalogItem) => string): string {
  const counts = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [key(i)]: (acc[key(i)] ?? 0) + 1 }), {});
  return Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}

function printSummary(items: CatalogItem[], report: Report): void {
  const withChart = items.filter((i) => i.sizeChart).length;
  log(`\n${items.length} items | shapes: ${countBy(items, (i) => i.shape)} | fits: ${countBy(items, (i) => i.fit)}`);
  log(`size charts: ${withChart}/${items.length} | swatch colour fallbacks: ${report.swatchFallbacks}`);
  if (report.unknownSizeParts.size > 0) log(`unmapped size-chart parts: ${[...report.unknownSizeParts].join(', ')}`);
  report.notes.forEach((n) => log(`  note: ${n}`));
  report.problems.forEach((p) => log(`  PROBLEM: ${p}`));
}

async function writeCatalog(out: string, items: CatalogItem[]): Promise<void> {
  const date = new Date().toISOString();
  const catalog = {
    source: `uniqlo.com/us commerce API (listing, details, size-charts), pulled ${date.slice(0, 10)}; colours sampled from UNIQLO swatch images`,
    generatedAt: date,
    items,
  };
  const tmp = `${out}.tmp`;
  await writeFile(tmp, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(tmp, out); // atomic swap so a running dev server never reads half a file
}

async function main(): Promise<number> {
  const args = parseCli();
  const report: Report = { notes: [], problems: [], unknownSizeParts: new Set(), swatchFallbacks: 0 };
  const fetched: Fetched[] = [];
  for (const group of GROUPS) fetched.push(...(await fetchGroup(group, report)));
  const pool = fetched.filter((f, i) => fetched.findIndex((g) => g.id === f.id) === i);

  const charts = await loadCharts(
    pool.map((p) => p.id),
    report,
  );
  const picked = choose(mapAll(pool, charts, report), args.perShape, report);
  const hexes = await sampleHexes(picked, report);
  const items = finalize(picked, hexes, report);
  printSummary(items, report);

  const minItems = Math.min(MIN_ITEMS, args.perShape * SHAPES.length);
  if (items.length < minItems) {
    log(`\nOnly ${items.length} valid items (need ${minItems}); ${args.out} left unchanged.`);
    return 1;
  }
  if (args.dryRun) {
    log('\nDry run: nothing written.');
    return 0;
  }
  await writeCatalog(args.out, items);
  log(`\nWrote ${items.length} items to ${args.out}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`build-catalog failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
