// FitRoom as a ChatGPT plugin: an MCP server (tools + one widget) built per request (stateless, so it runs on Vercel
// functions). Tools: recommend_size (the size to buy and a fit card, from UNIQLO's chart and the web app's sizing
// code), find_clothes (the catalog), try_on (the outfit on the shopper's own photo; FASHN API; free photos capped per
// ChatGPT user, or the linked FitRoom account's try-ons while paid try-ons are on: accounts.ts). The widget
// (widget.html) renders all three in the FitRoom design system. Contract: CLAUDE.md, ChatGPT plugin.
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
import { formatSize } from '../fit/sizing';
import { productCard, resolveColor, resolveProduct, searchCatalog, type Kind, type ProductCard } from './catalog';
import { callAccountTool, chargeTryOn, leftText, linkAccountResult, paid, withAccounts, type PluginAccount } from './accounts';
import { limitsFromEnv, reserve, reserveDaily, storeFromEnv, userKey, type QuotaStore } from './quota';
import { adviseSize, cardLines, matchSize, parseBody, type BodyInput } from './sizing';
import { defaultDeps, fetchShopperPhoto, tryOnOutfit, tryOnStatus, type Garment, type TryOnDeps } from './tryOn';

export const SERVER_NAME = 'fitroom';
export const SERVER_VERSION = '1.0.0';
export const WIDGET_URI = 'ui://fitroom/fitting-room-v1.html';
export const WIDGET_MIME = 'text/html;profile=mcp-app';
const TRY_ON_BUDGET_MS = 48_000; // inside vercel.json maxDuration 60 for api/mcp.ts
const PHOTO_META_KEY = 'fitroom/photo';

const INSTRUCTIONS = [
  "FitRoom picks the size to buy for UNIQLO men's tees, sweaters and pants from the shopper's height and weight",
  "(plus any measurements they know), using UNIQLO's own size charts, and shows how it will fit in numbers.",
  'It can also put the clothes on a photo of the shopper themselves.',
  'Repeat sizes and fit notes exactly as returned; when a size is marked as estimated or "between", say so.',
  'Never comment on how a person looks; describe only the clothes and the fit.',
].join(' ');

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
      "The size to buy in a UNIQLO men's tee, sweater or pants for this shopper, from UNIQLO's own size chart and " +
      'their height and weight (chest, waist, hips, inseam make it exact; blanks are estimated), and a fit card that ' +
      'compares it with one other size in numbers: chest or hip room, where the hem lands, shoulders, sleeve, inseam. ' +
      'Use whenever someone asks what size to get in a UNIQLO item, whether a size will fit, or how something will fit ' +
      "them. Ask for height and weight first if you don't know them. Repeat the size and its caveats exactly.",
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'UNIQLO US product link, product ID (E453754-000), or the item name.' },
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
    name: 'find_clothes',
    title: 'Browse UNIQLO basics',
    description:
      "Search FitRoom's catalog of UNIQLO men's tees, sweaters and pants: names, prices, colours and product photos. " +
      'Use to find something to size or try on. Each result has an ID for recommend_size and try_on.',
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
];

export interface ServerContext {
  ip: string;
  /** Paid try-ons (billing.ts) and the linked FitRoom account; absent or off = the monthly allowance per ChatGPT user. */
  account?: PluginAccount;
  env?: Record<string, string | undefined>;
  store?: QuotaStore;
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

async function recommendSize(args: Record<string, unknown>, ctx: ServerContext): Promise<CallToolResult> {
  const product = await resolveProduct(str(args.product) ?? '');
  if (!product.ok) return failure('size', product.message);
  const item = product.item;
  const { color, matched } = resolveColor(item, str(args.color));
  const body = parseBody(args as BodyInput, item.slot);
  if (!body.ok) return failure('size', body.message);
  const askedRaw = str(args.size);
  const asked = askedRaw ? matchSize(item, askedRaw) : null;
  const advice = adviseSize(item, body, asked);
  const card = productCard(item, color.code);
  const status = tryOnStatus(ctx.env ?? process.env);

  const lines = [`${item.name} (${card.color.name}, ${priceText(card)}): ${advice.text}`];
  if (advice.summary) lines.push(`${advice.summary}.`);
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
    pick: advice.pick,
    text: advice.text,
    summary: advice.summary,
    compare: advice.compare,
    borderline: advice.borderline,
    card: advice.card,
    estimated: advice.estimated,
    units: advice.units,
    buyUrl: card.url,
    tryOn: status.on ? { available: true } : { available: false, message: status.message },
  });
}

function findClothes(args: Record<string, unknown>): CallToolResult {
  const kinds: Kind[] = ['tee', 'sweater', 'pants', 'top', 'bottom'];
  const kind = kinds.includes(args.kind as Kind) ? (args.kind as Kind) : undefined;
  const maxPrice = typeof args.maxPrice === 'number' && Number.isFinite(args.maxPrice) ? args.maxPrice : undefined;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined;
  const hits = searchCatalog({ query: str(args.query), kind, color: str(args.color), maxPrice, limit });
  const items = hits.map(({ item, colorCode }) => ({
    ...productCard(item, colorCode),
    colors: item.colors.map((c) => ({ code: c.code, name: colorLabel(item, c.code), hex: c.hex })),
  }));
  if (items.length === 0) {
    const message = 'Nothing in the catalog matched. Try a broader search, or paste a UNIQLO US product link.';
    return result(message, { kind: 'catalog', items: [], message });
  }
  const text = items
    .map((p) => `${p.id} ${p.name}, ${priceText(p)}, ${p.colors.length} colours (${p.colors.slice(0, 6).map((c) => c.name).join(', ')}${p.colors.length > 6 ? ', …' : ''}), ${p.fit} fit`)
    .join('\n');
  return result(text, { kind: 'catalog', items });
}

const inFlightTryOns = new Set<string>();

/** One try-on photo's allowance: the month's free photos per ChatGPT user, or the linked account's try-ons. */
interface Ticket {
  /** Left after this photo; null = unlimited (accounts that never pay). */
  remaining: number | null;
  resetsAt: string | null;
  /** How `n` left reads to the shopper (null: say nothing). */
  textFor: (n: number | null) => string | null;
  release: () => Promise<void>;
}

async function tryOn(args: Record<string, unknown>, ctx: ServerContext, user: string): Promise<CallToolResult> {
  const env = ctx.env ?? process.env;
  const deps = ctx.deps ?? defaultDeps;
  const status = tryOnStatus(env);
  const tryOnFailure = (state: string, message: string, extra: Record<string, unknown> = {}) =>
    result(message, { kind: 'tryon', status: state, message, items: [], ...extra }, undefined, true);
  if (!status.on) return tryOnFailure('unavailable', status.message);
  if (paid(ctx.account) && !ctx.account.user) return linkAccountResult(ctx.account.origin);

  const garments: Garment[] = [];
  for (const slot of ['top', 'bottom'] as const) {
    const g = args[slot];
    if (!g || typeof g !== 'object') continue;
    const product = await resolveProduct(str((g as Record<string, unknown>).product) ?? '');
    if (!product.ok) return tryOnFailure('error', product.message);
    if (product.item.slot !== slot) {
      return tryOnFailure('error', `${product.item.name} is ${product.item.slot === 'top' ? 'a top' : 'pants'}; pass it as "${product.item.slot}".`);
    }
    garments.push({ item: product.item, colorCode: resolveColor(product.item, str((g as Record<string, unknown>).color)).color.code });
  }
  if (garments.length === 0) return tryOnFailure('error', 'Say which top or pants to try on.');

  if (inFlightTryOns.has(user)) return tryOnFailure('busy', 'Your last try-on is still developing. Wait for it to finish.');
  inFlightTryOns.add(user);
  try {
    const store = ctx.store ?? storeFromEnv(env);
    const limits = limitsFromEnv(env);
    let ticket: Ticket;
    if (paid(ctx.account)) {
      // The person's count is their FitRoom account (ledger); today's shared cap still bounds the spend.
      const day = await reserveDaily(store, limits, deps.now());
      if (!day.ok) {
        const message =
          day.reason === 'everyone' ? "FitRoom has made all of today's try-on photos. Try again tomorrow; size advice still works." : "Try-on photos can't start right now. Try again in a minute.";
        return tryOnFailure('unavailable', message);
      }
      const charge = await chargeTryOn(ctx.account);
      if (!charge.ok) {
        await day.release();
        return charge.result;
      }
      ticket = {
        remaining: charge.view.user?.left ?? null,
        resetsAt: null,
        textFor: (n) => (n === null ? null : leftText({ ...charge.view, user: charge.view.user ? { ...charge.view.user, left: n } : null })),
        release: async () => {
          await Promise.all([charge.release(), day.release()]);
        },
      };
    } else {
      const reservation = await reserve(store, user, limits, deps.now());
      if (!reservation.ok) {
        const when = new Date(reservation.resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
        const message =
          reservation.reason === 'user'
            ? `You've used your ${limits.perMonth} free try-on photos this month. They come back on ${when}. Size advice is unlimited.`
            : reservation.reason === 'everyone'
              ? "FitRoom has made all of today's free try-on photos. Try again tomorrow; size advice still works."
              : "Try-on photos can't start right now. Try again in a minute.";
        return tryOnFailure(reservation.reason === 'user' ? 'limit' : 'unavailable', message, { remaining: reservation.remaining, resetsAt: reservation.resetsAt });
      }
      ticket = {
        remaining: reservation.remaining,
        resetsAt: reservation.resetsAt,
        textFor: (n) => (n === null ? null : `${n} free try-on photo${n === 1 ? '' : 's'} left this month.`),
        release: reservation.release,
      };
    }
    /** What the shopper has left once a failed photo is given back. */
    const afterRelease = () => {
      const n = ticket.remaining === null ? null : ticket.remaining + 1;
      return { remaining: n, remainingText: ticket.textFor(n), resetsAt: ticket.resetsAt };
    };

    const deadline = deps.now() + TRY_ON_BUDGET_MS;
    const photo = await fetchShopperPhoto(args.photo, deps);
    if (!photo.ok) {
      await ticket.release();
      return tryOnFailure('photo', photo.message, afterRelease());
    }
    const outcome = await tryOnOutfit(photo.dataUrl, garments, status.key, deps, deadline);
    if (!outcome.ok) {
      await ticket.release();
      return tryOnFailure(outcome.kind === 'photo' ? 'photo' : outcome.kind, outcome.message, afterRelease());
    }
    const items = outcome.done.map((g) => productCard(g.item, g.colorCode));
    const names = outcome.done.map((g: Garment) => `${g.item.name} in ${colorLabel(g.item, g.colorCode)}`);
    const note = outcome.failed ? `The ${outcome.failed.garment.item.name} didn't go on: ${outcome.failed.failure.message}` : null;
    const text = [
      `The photo of you in the ${names.join(' and ')} is in the card above.`,
      'It shows the clothes as UNIQLO photographed them, not in your size; recommend_size gives the size and how it fits.',
      note,
      ticket.textFor(ticket.remaining),
    ]
      .filter(Boolean)
      .join(' ');
    return result(
      text,
      {
        kind: 'tryon',
        status: outcome.failed ? 'partial' : 'ok',
        message: note,
        items,
        remaining: ticket.remaining,
        remainingText: ticket.textFor(ticket.remaining),
        resetsAt: ticket.resetsAt,
      },
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

export function createServer(ctx: ServerContext): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION, title: 'FitRoom', icons: ICONS },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: withAccounts(TOOLS, ctx.account) }));

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
    const linked = paid(ctx.account) ? ctx.account.user : null;
    const user = linked ? `acct:${linked.sub}` : userKey(request.params._meta as Record<string, unknown> | undefined, ctx.ip);
    try {
      if (paid(ctx.account)) {
        const own = await callAccountTool(request.params.name, ctx.account);
        if (own) return own;
      }
      switch (request.params.name) {
        case 'recommend_size':
          return await recommendSize(args, ctx);
        case 'find_clothes':
          return findClothes(args);
        case 'try_on':
          return await tryOn(args, ctx, user);
        default:
          return failure('message', `Unknown tool ${request.params.name}.`);
      }
    } catch (err: unknown) {
      console.error('[mcp] tool crashed', request.params.name, err instanceof Error ? err.stack ?? err.message : err);
      return failure('message', 'Something went wrong on FitRoom. Try again.');
    }
  });

  return server;
}

