// FitRoom as a ChatGPT plugin: an MCP server (tools + one widget) built per request (stateless, so it runs on Vercel
// functions). Tools: recommend_size (the size to buy and a fit card, from UNIQLO's chart and the web app's sizing
// code, plus what earlier buyers reported), find_clothes (the catalog), try_on (the outfit on the shopper's own photo;
// FASHN API; free photos capped per ChatGPT user), report_fit (how a bought item fits: anonymous tallies). The widget
// (widget.html) renders the first three in the FitRoom design system. Every call is counted without personal data
// (metrics.ts). Contract: CLAUDE.md, ChatGPT plugin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { colorLabel } from '../fit/catalogItem';
import { chartSizes, formatSize, shortSize } from '../fit/sizing';
import { fromDisplay, LIMITS, type Units } from '../fit/profile';
import { catalogItems, colorFromLink, COVERAGE, notCoveredMessage, productCard, resolveColor, resolveProduct, searchCatalog, type Kind, type ProductCard } from './catalog';
import { addReport, MIN_REPORTS, readReports, reportLine, VERDICTS, WHERE, type SizeReports, type Verdict, type Where } from './fitReports';
import { recordCall } from './metrics';
import { limitsFromEnv, reserve, userKey } from './quota';
import { adviseSize, cardLines, chartLines, generalChartItem, matchSize, parseBody, sizeChartFor, type BodyInput } from './sizing';
import { storeFromEnv, type Store } from './store';
import { defaultDeps, fetchShopperPhoto, tryOnOutfit, tryOnStatus, type Garment, type TryOnDeps } from './tryOn';

export const SERVER_NAME = 'fitroom';
export const SERVER_VERSION = '1.0.0';
export const WIDGET_URI = 'ui://fitroom/fitting-room-v2.html'; // v2: size-chart view, recommended size as headline
export const WIDGET_MIME = 'text/html;profile=mcp-app';
const TRY_ON_BUDGET_MS = 48_000; // inside vercel.json maxDuration 60 for api/mcp.ts
const PHOTO_META_KEY = 'fitroom/photo';

/** What the model is told about FitRoom; the try-on and fit-report lines only when those tools are listed. */
export function instructionsFor(tools: Tool[]): string {
  const has = (name: string) => tools.some((t) => t.name === name);
  return [
    "FitRoom answers UNIQLO sizing questions for men's T-shirts, sweaters, sweatshirts, jeans, chinos and other pants",
    "from UNIQLO's own size charts: what size to buy for the shopper's height and weight (plus any measurements they",
    'know) with how it will fit in numbers (recommend_size), and how an item is sized: true to size, runs small or big,',
    "what a size measures, which size for a chest or waist (size_chart, no height or weight needed). Use these instead",
    "of web search for UNIQLO sizing, and never guess a size FitRoom didn't give. If FitRoom says it doesn't cover an",
    "item (jackets, coats, shorts, button-up shirts, women's or kids'), say so rather than guessing.",
    has('try_on') ? 'It can also put the clothes on a photo of the shopper themselves.' : null,
    'Repeat sizes and fit notes exactly as returned; when a size is marked as estimated or "between", say so.',
    has('report_fit') ? 'When the user says how a UNIQLO item they bought fits, record it with report_fit.' : null,
    'Never comment on how a person looks; describe only the clothes and the fit.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A hanger, monochrome on a 20x20 viewBox (ChatGPT asks for currentColor icons on entrypoint tools). */
const ICON =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7.5V6.6a1.8 1.8 0 1 0-1.8-1.8"/><path d="M10 7.5 2.6 13.2c-.7.5-.3 1.6.5 1.6h13.8c.8 0 1.2-1.1.5-1.6L10 7.5Z"/></svg>',
  ).toString('base64');
const ICONS = [{ src: ICON, mimeType: 'image/svg+xml', sizes: ['any'] }];

let widgetCache: string | null = null;
const WIDGET_PATHS = ['api/_lib/mcp/widget.html', '../api/_lib/mcp/widget.html'];

export function widgetHtml(): string {
  if (widgetCache) return widgetCache;
  for (const rel of WIDGET_PATHS) {
    try {
      widgetCache = readFileSync(join(process.cwd(), rel), 'utf8');
      return widgetCache;
    } catch {
      // next
    }
  }
  throw new Error(`widget.html not found from ${process.cwd()}`);
}

function toolMeta(invoking: string, invoked: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] },
    'openai/outputTemplate': WIDGET_URI,
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked,
    'openai/widgetAccessible': true,
    securitySchemes: [{ type: 'noauth' }],
    ...extra,
  };
}

const MEASURE = (what: string) => ({ type: 'number', description: `${what}, in inches (imperial) or cm (metric). Only if the shopper gave it.` });

const garmentSchema = (slot: string) => ({
  type: 'object',
  description: `The ${slot} to put on, from the catalog or any UNIQLO US link.`,
  properties: {
    product: { type: 'string', description: 'UNIQLO product ID (E453754-000), link, or catalog name.' },
    color: { type: 'string', description: 'Colour name or UNIQLO colour code. Optional.' },
  },
  required: ['product'],
  additionalProperties: false,
});

export const TOOLS: Tool[] = [
  {
    name: 'recommend_size',
    title: 'Find my size',
    description:
      "The size to buy in a UNIQLO men's T-shirt, sweater, sweatshirt or pants (jeans, chinos, trousers) for this " +
      "shopper, from UNIQLO's own size chart and their height and weight (chest, waist, hips, inseam make it exact; " +
      'blanks are estimated), with a fit card comparing it with one other size in numbers (chest or hip room, where ' +
      'the hem lands, shoulders, sleeve, inseam) and what earlier buyers of that size reported. Use whenever someone ' +
      'asks what size to get at UNIQLO, S or M, whether a size will fit them, or how it will fit them; works for any ' +
      "UNIQLO US product link in those categories. If you don't know their height and weight, ask for them (questions " +
      'about the item itself go to size_chart). If the user pasted a UNIQLO link, pass that link as product, unchanged: ' +
      'it carries the colour. Repeat the size and its caveats exactly; the size to buy is `size`, not the size asked about.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'The UNIQLO US product link exactly as pasted (keeps the colour), else the product ID (E453754-000) or the item name.' },
        color: { type: 'string', description: 'Colour name or UNIQLO colour code. Optional.' },
        units: { type: 'string', enum: ['imperial', 'metric'], description: 'imperial = inches and pounds (default), metric = cm and kg.' },
        height: { type: 'number', description: "Height: total inches (5'10\" = 70) or cm." },
        weight: { type: 'number', description: 'Weight in pounds or kg.' },
        chest: MEASURE('Chest circumference'),
        waist: MEASURE('Waist circumference'),
        hips: MEASURE('Hip circumference'),
        inseam: MEASURE('Inseam (crotch to floor)'),
        fit: { type: 'string', enum: ['close', 'regular', 'relaxed'], description: 'How they like it to fit. Default regular.' },
        size: { type: 'string', description: 'A size they are considering ("M", "32"), to compare with the recommendation.' },
        ownGarment: {
          type: 'object',
          description: 'A top or pants of their own that fits well, measured laid flat. Beats the fit preference.',
          properties: {
            chestFlat: { type: 'number', description: 'Top: armpit to armpit, laid flat.' },
            length: { type: 'number', description: 'Top: high shoulder point to hem.' },
            hipsFlat: { type: 'number', description: 'Pants: across the hips, laid flat.' },
            inseam: { type: 'number', description: 'Pants: inseam.' },
          },
          additionalProperties: false,
        },
      },
      required: ['product', 'height', 'weight'],
      additionalProperties: false,
    },
    annotations: { title: 'Find my size', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    icons: ICONS,
    _meta: toolMeta("Checking UNIQLO's size chart", 'Size ready'),
  },
  {
    name: 'size_chart',
    title: 'UNIQLO size chart',
    description:
      "How a UNIQLO men's T-shirt, sweater, sweatshirt or pants (jeans, chinos) is sized, from UNIQLO's own size chart: " +
      'the body measurements each size is made for, what the garment measures (chest, length, sleeve, waist, hips, ' +
      'inseam), how the cut runs (close, regular, relaxed) and what buyers reported. No height or weight needed. Use for ' +
      '"is it true to size", "does it run small or big", "should I size up or down", "what does a medium measure", ' +
      '"what size is a 40 inch chest / 32 inch waist", "UNIQLO size chart", for one item or (without a product) ' +
      "UNIQLO men's tops or pants in general. Prefer it to web search for UNIQLO sizing. For the size a particular " +
      'person should buy, recommend_size with their height and weight.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'UNIQLO product link (as pasted), ID or name. Omit for UNIQLO men\'s tops or pants in general.' },
        kind: { type: 'string', enum: ['top', 'bottom'], description: 'Without a product: tops (T-shirts, sweaters) or bottoms (pants). Default top.' },
        size: { type: 'string', description: 'One size they asked about ("M", "32").' },
        chest: { type: 'number', description: 'A chest measurement to look up (tops), in inches or cm.' },
        waist: { type: 'number', description: 'A waist measurement to look up (pants), in inches or cm.' },
        hips: { type: 'number', description: 'Hip measurement, if given.' },
        units: { type: 'string', enum: ['imperial', 'metric'], description: 'imperial = inches (default), metric = cm.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'UNIQLO size chart', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    icons: ICONS,
    _meta: toolMeta("Reading UNIQLO's size chart", 'Size chart ready'),
  },
  {
    name: 'find_clothes',
    title: 'Browse UNIQLO basics',
    description:
      "Search FitRoom's catalog of UNIQLO men's T-shirts, sweaters and pants: names, prices, colours and product " +
      'photos. Use when someone wants UNIQLO basics to choose from ("a black crew neck under $30", "chinos", "basics ' +
      'for fall"), or to find the ID of an item to size or try on. FitRoom has no jackets, coats, hoodies, shorts, ' +
      "button-up shirts, women's or kids' items: for those, say FitRoom can't help rather than guessing a size.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "black crew neck", "cashmere", "chinos".' },
        kind: { type: 'string', enum: ['tee', 'sweater', 'pants', 'top', 'bottom'] },
        color: { type: 'string', description: 'Colour name, e.g. "navy".' },
        maxPrice: { type: 'number', description: 'Highest price in USD.' },
        limit: { type: 'number', description: 'How many results (1-12, default 8).' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Browse UNIQLO basics', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    icons: ICONS,
    _meta: toolMeta('Looking through the catalog', 'Here are some options'),
  },
  {
    name: 'try_on',
    title: 'Try it on me',
    description:
      "Puts UNIQLO clothes on the user's own full-body photo: their photo, re-dressed in a top and/or pants, keeping " +
      'their face, body, pose and background. Only for photos of the user themselves: never other people, never ' +
      'children. Needs a photo attached in the chat. Takes about 10-20 seconds; free photos are limited per person per ' +
      "month. The photo shows the clothes as photographed, not in the user's size, so give the size from recommend_size.",
    inputSchema: {
      type: 'object',
      properties: {
        photo: {
          type: 'object',
          description: 'The full-body photo of the user that they attached.',
          properties: {
            download_url: { type: 'string' },
            file_id: { type: 'string' },
            mime_type: { type: 'string' },
            file_name: { type: 'string' },
          },
          required: ['download_url'],
        },
        top: garmentSchema('top (tee or sweater)'),
        bottom: garmentSchema('pants'),
      },
      required: ['photo'],
      additionalProperties: false,
    },
    annotations: { title: 'Try it on me', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    icons: ICONS,
    _meta: toolMeta('Dressing your photo', 'Photo ready', { 'openai/fileParams': ['photo'] }),
  },
  {
    name: 'report_fit',
    title: 'Tell FitRoom how it fit',
    description:
      'Records how a UNIQLO item the user bought fits them ("the M was tight in the chest", "the 30 waist was perfect"), ' +
      'so recommend_size can tell later shoppers what buyers of that size found. Only when the user says it about an ' +
      'item they own; never guess or ask leading questions. Anonymous: no measurements are kept, one report per person ' +
      'per item.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'UNIQLO product ID, link, or catalog name.' },
        size: { type: 'string', description: 'The size they bought ("M", "30").' },
        fit: { type: 'string', enum: [...VERDICTS], description: 'too_small, just_right or too_big.' },
        where: { type: 'string', enum: [...WHERE], description: 'Where it was off, if they said. Default overall.' },
      },
      required: ['product', 'size', 'fit'],
      additionalProperties: false,
    },
    annotations: { title: 'Tell FitRoom how it fit', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    icons: ICONS,
    _meta: {
      securitySchemes: [{ type: 'noauth' }],
      'openai/toolInvocation/invoking': 'Noting how it fit',
      'openai/toolInvocation/invoked': 'Noted',
    },
  },
];

export interface ServerContext {
  ip: string;
  env?: Record<string, string | undefined>;
  store?: Store;
  deps?: TryOnDeps;
}

function result(text: string, structured: Record<string, unknown>, meta?: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured, ...(meta ? { _meta: meta } : {}), ...(isError ? { isError } : {}) };
}

function failure(kind: string, message: string): CallToolResult {
  return result(message, { kind, status: 'error', message }, undefined, true);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function priceText(p: ProductCard): string {
  return p.salePrice != null && p.salePrice < p.price ? `$${p.salePrice.toFixed(2)} (was $${p.price.toFixed(2)})` : `$${p.price.toFixed(2)}`;
}

/** Tallies for the sizes on the fit card that have enough reports to show; {} when the store can't be read. */
async function shownReports(store: Store, productId: string, sizes: string[]): Promise<Record<string, SizeReports>> {
  try {
    const all = await readReports(store, productId);
    return Object.fromEntries(sizes.filter((s) => (all[s]?.total ?? 0) >= MIN_REPORTS).map((s) => [s, all[s]]));
  } catch (err: unknown) {
    console.error('[mcp] fit reports read failed', err instanceof Error ? err.message : err);
    return {};
  }
}

async function recommendSize(args: Record<string, unknown>, ctx: ServerContext, store: Store): Promise<CallToolResult> {
  const product = await resolveProduct(str(args.product) ?? '');
  if (!product.ok) return failure('size', product.message);
  const item = product.item;
  const { color, matched } = resolveColor(item, str(args.color) ?? colorFromLink(str(args.product)));
  const body = parseBody(args as BodyInput, item.slot);
  if (!body.ok) return failure('size', body.message);
  const askedRaw = str(args.size);
  const asked = askedRaw ? matchSize(item, askedRaw) : null;
  const advice = adviseSize(item, body, asked);
  const card = productCard(item, color.code);
  const status = tryOnStatus(ctx.env ?? process.env);
  const reports = advice.size ? await shownReports(store, item.id, advice.cardSizes) : {};
  const reportText = advice.size ? reportLine(reports[advice.size]) : null;

  const lines = [`${item.name} (${card.color.name}, ${priceText(card)}): ${advice.text}`];
  if (advice.summary) lines.push(`${advice.summary}.`);
  if (advice.askedLabel && advice.askedSummary) lines.push(`In the ${advice.askedLabel} they asked about: ${advice.askedSummary.charAt(0).toLowerCase()}${advice.askedSummary.slice(1)}.`);
  if (reportText) lines.push(reportText);
  if (askedRaw && !asked) lines.push(`"${askedRaw}" isn't one of its sizes (${card.sizes.map(formatSize).join(', ')}).`);
  if (!matched) lines.push(`No colour "${str(args.color)}"; showing ${card.color.name}.`);
  if (advice.card) lines.push(...cardLines(advice.card));
  if (!advice.card && advice.estimated.length) lines.push(`Estimated from height and weight: ${advice.estimated.join(', ')}.`);
  lines.push(`Buy at UNIQLO: ${card.url}${advice.sizeLabel ? ` (choose ${advice.sizeLabel})` : ''}`);

  return result(lines.join('\n'), {
    kind: 'size',
    product: card,
    size: advice.size,
    sizeLabel: advice.sizeLabel,
    asked: advice.asked,
    askedLabel: advice.askedLabel,
    askedSummary: advice.askedSummary,
    pick: advice.pick,
    text: advice.text,
    summary: advice.summary,
    compare: advice.compare,
    borderline: advice.borderline,
    card: advice.card,
    estimated: advice.estimated,
    units: advice.units,
    buyUrl: card.url,
    reports,
    reportText,
    /** Whether report_fit is offered here, so the card only invites fit reports that will be kept. */
    reportsOn: toolsFor(ctx).some((t) => t.name === 'report_fit'),
    tryOn: status.on ? { available: true } : { available: false, message: status.message },
  });
}

/** The item's own size name for what the user said ("m", "30", '30"'), from the chart or the size list. */
function boughtSize(item: Parameters<typeof matchSize>[0], raw: unknown): string | null {
  const fromChart = matchSize(item, raw);
  if (fromChart) return fromChart;
  if (typeof raw !== 'string') return null;
  const want = raw.trim().toLowerCase().replace(/["”\s]|inch(es)?$/g, '');
  const sizes = Array.isArray(item.sizes) ? item.sizes : chartSizes(item);
  return sizes.find((s) => s.toLowerCase() === raw.trim().toLowerCase() || shortSize(s).toLowerCase() === want) ?? null;
}

const VERDICT_TEXT: Record<Verdict, string> = { too_small: 'runs small', just_right: 'fits', too_big: 'runs big' };

async function reportFit(args: Record<string, unknown>, store: Store, user: string): Promise<CallToolResult> {
  const product = await resolveProduct(str(args.product) ?? '');
  if (!product.ok) return failure('message', product.message);
  const item = product.item;
  const size = boughtSize(item, args.size);
  const sizes = Array.isArray(item.sizes) ? item.sizes : [];
  if (!size) return failure('message', `Which size did they buy? The ${item.name} comes in ${sizes.map(formatSize).join(', ')}.`);
  if (!(VERDICTS as readonly unknown[]).includes(args.fit)) return failure('message', 'Say whether it was too small, just right or too big.');
  const verdict = args.fit as Verdict;
  const where = (WHERE as readonly unknown[]).includes(args.where) ? (args.where as Where) : null;
  let added: boolean;
  try {
    added = await addReport(store, user, item.id, size, verdict, where);
  } catch (err: unknown) {
    console.error('[mcp] fit report failed', err instanceof Error ? err.message : err);
    return failure('message', "FitRoom couldn't save that right now. Try again later.");
  }
  const label = formatSize(size);
  if (!added) {
    const message = `This person already told FitRoom how the ${item.name} fits; one report per item counts. Thanks.`;
    return result(message, { kind: 'message', status: 'duplicate', message, productId: item.id });
  }
  const tallies = await readReports(store, item.id).catch(() => ({}) as Record<string, SizeReports>);
  const line = reportLine(tallies[size]);
  const off = where && verdict !== 'just_right' ? ` (${where})` : '';
  const message = [
    `Thanks: noted that the ${item.name} in ${label} ${VERDICT_TEXT[verdict]}${off}.`,
    line ?? `FitRoom shows these to other shoppers once a size has ${MIN_REPORTS} reports.`,
  ].join(' ');
  return result(message, { kind: 'message', status: 'ok', message, productId: item.id });
}

/** A chest / waist / hips from the shopper's units to cm, when it's a believable body measurement. */
function measureCm(raw: unknown, key: 'chestCm' | 'waistCm' | 'hipsCm', units: Units): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const cm = fromDisplay(key, raw, units);
  const [min, max] = LIMITS[key];
  return cm >= min && cm <= max ? cm : undefined;
}

async function sizeChart(args: Record<string, unknown>, store: Store): Promise<CallToolResult> {
  const units: Units = args.units === 'metric' ? 'metric' : 'imperial';
  const measure = { chestCm: measureCm(args.chest, 'chestCm', units), waistCm: measureCm(args.waist, 'waistCm', units), hipsCm: measureCm(args.hips, 'hipsCm', units) };
  const productText = str(args.product);
  const lines: string[] = [];
  const charts: { title: string; chart: NonNullable<ReturnType<typeof sizeChartFor>> }[] = [];
  let card: ProductCard | null = null;
  let fitLabel: string | null = null;
  let reportTexts: string[] = [];

  if (productText) {
    const product = await resolveProduct(productText);
    if (!product.ok) return failure('chart', product.message);
    const item = product.item;
    const { color } = resolveColor(item, colorFromLink(productText));
    card = productCard(item, color.code);
    const chart = sizeChartFor(item, units, measure);
    if (!chart) return failure('chart', `UNIQLO publishes no size chart FitRoom can read for ${item.name}. Check the size guide on the product page: ${card.url}`);
    charts.push({ title: item.name, chart });
    fitLabel = `UNIQLO calls it a ${item.fit} fit`;
    const tallies = await shownReports(store, item.id, chartSizes(item));
    reportTexts = Object.values(tallies)
      .map((r) => reportLine(r))
      .filter((t): t is string => Boolean(t));
  } else {
    const slot = args.kind === 'bottom' ? 'bottom' : 'top';
    for (const letters of slot === 'top' ? [true] : [true, false]) {
      const item = generalChartItem(catalogItems(), slot, letters);
      const chart = item && sizeChartFor(item, units, measure);
      if (item && chart) charts.push({ title: item.name, chart });
    }
    if (charts.length === 0) return failure('chart', 'FitRoom has no size charts for that yet.');
    lines.push(`Most of UNIQLO's men's ${slot === 'top' ? 'T-shirts and sweaters' : 'pants'} share these body ranges; individual items vary, so name one for its exact chart.`);
  }

  const askedSize = str(args.size);
  for (const { title, chart } of charts) {
    lines.push(`${title}: UNIQLO's size chart (body = who each size is made for; garment = the item itself, measured all the way round):`);
    const rows = askedSize ? chart.rows.filter((r) => r.label.toLowerCase().replace('"', '') === askedSize.toLowerCase().replace(/["\s]|inch(es)?$/g, '') || r.size.toLowerCase() === askedSize.toLowerCase()) : [];
    lines.push(...chartLines(rows.length ? { ...chart, rows } : chart));
    if (chart.cut) lines.push(`How it runs: ${fitLabel ? `${fitLabel}; ` : ''}${chart.cut.roomText}, which reads as a ${chart.cut.ease} cut.`);
    else if (fitLabel) lines.push(`${fitLabel}.`);
    if (chart.match) lines.push(chart.match.text);
  }
  lines.push(...reportTexts);
  lines.push("For the size a person should buy and how it fits them (room, where the hem lands), use recommend_size with their height and weight.");
  if (card) lines.push(`UNIQLO page: ${card.url}`);

  return result(lines.join('\n'), {
    kind: 'chart',
    product: card,
    fitLabel,
    general: !productText,
    charts: charts.map(({ title, chart }) => ({ title, ...chart })),
    askedSize: askedSize ?? null,
    reportTexts,
    note: productText ? null : lines[0],
  });
}

function findClothes(args: Record<string, unknown>): CallToolResult {
  const kinds: Kind[] = ['tee', 'sweater', 'pants', 'top', 'bottom'];
  const kind = kinds.includes(args.kind as Kind) ? (args.kind as Kind) : undefined;
  const maxPrice = typeof args.maxPrice === 'number' && Number.isFinite(args.maxPrice) ? args.maxPrice : undefined;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined;
  const notCovered = str(args.query) ? notCoveredMessage(str(args.query)!) : null;
  if (notCovered) return result(notCovered, { kind: 'catalog', items: [], status: 'not_covered', message: notCovered });
  const hits = searchCatalog({ query: str(args.query), kind, color: str(args.color), maxPrice, limit });
  const items = hits.map(({ item, colorCode }) => ({
    ...productCard(item, colorCode),
    colors: item.colors.map((c) => ({ code: c.code, name: colorLabel(item, c.code), hex: c.hex })),
  }));
  if (items.length === 0) {
    const message = `Nothing in FitRoom's catalog matched. ${COVERAGE}; try a broader search or paste a UNIQLO US product link, and don't guess a size for anything else.`;
    return result(message, { kind: 'catalog', items: [], message });
  }
  const text = items
    .map((p) => `${p.id} ${p.name}, ${priceText(p)}, ${p.colors.length} colours (${p.colors.slice(0, 6).map((c) => c.name).join(', ')}${p.colors.length > 6 ? ', …' : ''}), ${p.fit} fit`)
    .join('\n');
  return result(text, { kind: 'catalog', items });
}

const inFlightTryOns = new Set<string>();

async function tryOn(args: Record<string, unknown>, ctx: ServerContext, user: string, store: Store): Promise<CallToolResult> {
  const env = ctx.env ?? process.env;
  const deps = ctx.deps ?? defaultDeps;
  const status = tryOnStatus(env);
  const tryOnFailure = (state: string, message: string, extra: Record<string, unknown> = {}) =>
    result(message, { kind: 'tryon', status: state, message, items: [], ...extra }, undefined, true);
  if (!status.on) return tryOnFailure('unavailable', status.message);

  const garments: Garment[] = [];
  for (const slot of ['top', 'bottom'] as const) {
    const g = args[slot];
    if (!g || typeof g !== 'object') continue;
    const product = await resolveProduct(str((g as Record<string, unknown>).product) ?? '');
    if (!product.ok) return tryOnFailure('error', product.message);
    if (product.item.slot !== slot) {
      return tryOnFailure('error', `${product.item.name} is ${product.item.slot === 'top' ? 'a top' : 'pants'}; pass it as "${product.item.slot}".`);
    }
    const asked = str((g as Record<string, unknown>).color) ?? colorFromLink(str((g as Record<string, unknown>).product));
    garments.push({ item: product.item, colorCode: resolveColor(product.item, asked).color.code });
  }
  if (garments.length === 0) return tryOnFailure('error', 'Say which top or pants to try on.');

  if (inFlightTryOns.has(user)) return tryOnFailure('busy', 'Your last try-on is still developing. Wait for it to finish.');
  inFlightTryOns.add(user);
  try {
    const limits = limitsFromEnv(env);
    const ticket = await reserve(store, user, limits, deps.now());
    if (!ticket.ok) {
      const when = new Date(ticket.resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
      const message =
        ticket.reason === 'user'
          ? `You've used your ${limits.perMonth} free try-on photos this month. They come back on ${when}. Size advice is unlimited.`
          : ticket.reason === 'everyone'
            ? "FitRoom has made all of today's free try-on photos. Try again tomorrow; size advice still works."
            : "Try-on photos can't start right now. Try again in a minute.";
      return tryOnFailure(ticket.reason === 'user' ? 'limit' : 'unavailable', message, { remaining: ticket.remaining, resetsAt: ticket.resetsAt });
    }

    const deadline = deps.now() + TRY_ON_BUDGET_MS;
    const photo = await fetchShopperPhoto(args.photo, deps);
    if (!photo.ok) {
      await ticket.release();
      return tryOnFailure('photo', photo.message, { remaining: ticket.remaining + 1 });
    }
    const outcome = await tryOnOutfit(photo.dataUrl, garments, status.key, deps, deadline);
    if (!outcome.ok) {
      await ticket.release();
      return tryOnFailure(outcome.kind === 'photo' ? 'photo' : outcome.kind, outcome.message, { remaining: ticket.remaining + 1 });
    }
    const items = outcome.done.map((g) => productCard(g.item, g.colorCode));
    const names = outcome.done.map((g: Garment) => `${g.item.name} in ${colorLabel(g.item, g.colorCode)}`);
    const note = outcome.failed ? `The ${outcome.failed.garment.item.name} didn't go on: ${outcome.failed.failure.message}` : null;
    const text = [
      `The photo of you in the ${names.join(' and ')} is in the card above.`,
      'It shows the clothes as UNIQLO photographed them, not in your size; recommend_size gives the size and how it fits.',
      note,
      `${ticket.remaining} free try-on photo${ticket.remaining === 1 ? '' : 's'} left this month.`,
    ]
      .filter(Boolean)
      .join(' ');
    return result(
      text,
      { kind: 'tryon', status: outcome.failed ? 'partial' : 'ok', message: note, items, remaining: ticket.remaining, resetsAt: ticket.resetsAt },
      { [PHOTO_META_KEY]: outcome.image },
    );
  } finally {
    inFlightTryOns.delete(user);
  }
}

/**
 * CSP for the widget: UNIQLO product photos and the two FitRoom fonts; no network calls (tools go through the host).
 * No `ui.domain`: its format is host-specific and the spec's default sandbox origin is all the widget needs.
 */
function widgetResourceMeta(): Record<string, unknown> {
  const resourceDomains = ['https://image.uniqlo.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
  return {
    ui: { csp: { resourceDomains, connectDomains: [] }, prefersBorder: true },
    'openai/widgetDescription': 'FitRoom: the size to buy, how it fits in numbers, and try-on photos of UNIQLO basics.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': { resource_domains: resourceDomains, connect_domains: [] },
  };
}

/** What a call came to, for the usage counters: ok | borderline | no_chart | empty | duplicate | <try-on status> | error. */
export function outcomeOf(res: CallToolResult): string {
  const sc = (res.structuredContent ?? {}) as Record<string, unknown>;
  if (typeof sc.status === 'string' && sc.status !== 'error') return sc.status;
  if (res.isError) return 'error';
  if (sc.kind === 'size') return sc.size == null ? 'no_chart' : sc.borderline ? 'borderline' : 'ok';
  if (sc.kind === 'catalog') return Array.isArray(sc.items) && sc.items.length ? 'ok' : 'empty';
  if (sc.kind === 'chart') return sc.general ? 'general' : 'ok';
  return 'ok';
}

/** The catalog ID a call was about (none for a search). */
function productOf(res: CallToolResult): { product?: string } {
  const sc = (res.structuredContent ?? {}) as { product?: { id?: unknown }; items?: { id?: unknown }[]; productId?: unknown; kind?: unknown };
  const id = sc.product?.id ?? sc.productId ?? (sc.kind === 'tryon' ? sc.items?.[0]?.id : undefined);
  return typeof id === 'string' ? { product: id } : {};
}

/**
 * The tools this deployment can actually serve: try_on only with a FASHN key (else it could only say "not switched
 * on"), report_fit only with a shared store (in memory a "noted" report would vanish with the instance).
 */
export function toolsFor(ctx: Pick<ServerContext, 'env' | 'store'>): Tool[] {
  const env = ctx.env ?? process.env;
  const sharedStore = Boolean(ctx.store) || storeFromEnv(env).kind === 'upstash';
  return TOOLS.filter((t) => (t.name === 'try_on' ? tryOnStatus(env).on : t.name === 'report_fit' ? sharedStore : true));
}

export function createServer(ctx: ServerContext): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION, title: 'FitRoom', icons: ICONS },
    { capabilities: { tools: {}, resources: {} }, instructions: instructionsFor(toolsFor(ctx)) },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(ctx) }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: WIDGET_URI, name: 'FitRoom fitting room', mimeType: WIDGET_MIME, _meta: widgetResourceMeta() }],
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== WIDGET_URI) throw new Error(`Unknown resource ${request.params.uri}`);
    return { contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: widgetHtml(), _meta: widgetResourceMeta() }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const user = userKey(request.params._meta as Record<string, unknown> | undefined, ctx.ip);
    const store = ctx.store ?? storeFromEnv(ctx.env ?? process.env);
    const tool = request.params.name;
    const started = Date.now();
    let res: CallToolResult;
    try {
      switch (tool) {
        case 'recommend_size':
          res = await recommendSize(args, ctx, store);
          break;
        case 'find_clothes':
          res = findClothes(args);
          break;
        case 'size_chart':
          res = await sizeChart(args, store);
          break;
        case 'try_on':
          res = await tryOn(args, ctx, user, store);
          break;
        case 'report_fit':
          res = toolsFor(ctx).some((t) => t.name === 'report_fit')
            ? await reportFit(args, store, user)
            : failure('message', "FitRoom can't record fit reports on this deployment yet.");
          break;
        default:
          return failure('message', `Unknown tool ${tool}.`);
      }
    } catch (err: unknown) {
      console.error('[mcp] tool crashed', tool, err instanceof Error ? err.stack ?? err.message : err);
      res = failure('message', 'Something went wrong on FitRoom. Try again.');
    }
    const event = { tool, outcome: outcomeOf(res), ms: Date.now() - started, ...productOf(res) };
    await recordCall(store, user, event, Date.now(), (ctx.env ?? process.env).MCP_EVENT_LOGS !== '0');
    return res;
  });

  return server;
}

