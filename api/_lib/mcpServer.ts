// The FitRoom MCP server for ChatGPT plugins: tools to find UNIQLO pieces and to try them on the shopper's own photo in
// a FitRoom panel (UI resource). The try-on itself runs in the shopper's browser inside ChatGPT, on the same free
// Hugging Face Space as the website, and spends the same looks as the website (account.ts, ledger.ts).
// ChatGPT's plugin rules (developers.openai.com/plugins/plugin-guidelines, Commerce): no selling credits, no checkout
// links, no upsells in ChatGPT. Signed-in shoppers use the looks their account already has; when it has none, FitRoom
// says so and links to an informational page (try-ons.html), nothing more.
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountView, isExempt, type AccountView, type BillingConfig } from './billing';
import { admit, giveBack, LOOK_ID_RE } from './account';
import { ledger } from './ledger';
import { authChallenge, SCOPE } from './oauth';
import type { SessionUser } from './session';
import type { CatalogColor, CatalogItem } from './uniqlo';

export const WIDGET_URI = 'ui://fitroom/try-on-v1.html';
const MIME = 'text/html;profile=mcp-app';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const FASHN_SPACE = 'fashn-ai/fashn-vton-1.5';
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const PHOTO_FETCH_MS = 15_000;

export interface McpContext {
  origin: string;
  config: BillingConfig;
  /** The linked FitRoom account (OAuth access token), or null. */
  user: SessionUser | null;
  env?: NodeJS.ProcessEnv;
}

export const INSTRUCTIONS = `FitRoom shows UNIQLO men's tees, sweaters and pants on the shopper's own photo and picks the size to buy.
1. Use find_clothes to pick a top and/or bottoms (ids and colour codes come from its results).
2. Call try_on with the shopper's full-body front photo (attached in the chat) and the chosen items. Pass height and
   weight if the shopper gave them, so the panel can show the size to buy. The panel re-dresses the photo (about a minute)
   and shows the size and fit; their face, body and background stay as they are.
Each new outfit (or the same outfit with one piece changed) uses one of the shopper's FitRoom try-ons; trying the same
outfit again is free. Only photos of the shopper themselves.`;

// ---- Catalog ----

let catalog: { items: CatalogItem[]; at: number; origin: string } | null = null;

/** Forgets the cached catalog (tests). */
export function resetCatalog(): void {
  catalog = null;
}

async function loadCatalog(origin: string): Promise<CatalogItem[]> {
  if (catalog && catalog.origin === origin && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.items;
  const res = await fetch(`${origin}/catalog.json`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const data = (await res.json()) as { items?: CatalogItem[] };
  const items = Array.isArray(data.items) ? data.items.filter((i) => i && typeof i.id === 'string' && Array.isArray(i.colors) && i.colors.length > 0) : [];
  catalog = { items, at: Date.now(), origin };
  return items;
}

function findColor(item: CatalogItem, wanted: string | undefined): CatalogColor {
  const w = wanted?.trim().toLowerCase();
  if (!w) return item.colors[0];
  return item.colors.find((c) => c.code === w) ?? item.colors.find((c) => c.name.toLowerCase() === w) ?? item.colors.find((c) => c.name.toLowerCase().includes(w)) ?? item.colors[0];
}

/** UNIQLO's photo of the item in this colour (same rule as web/src/catalog/types.ts productImage). */
export function productImage(item: CatalogItem, code: string): string | undefined {
  const color = item.colors.find((c) => c.code === code) ?? item.colors[0];
  return color.image ?? item.image?.replace(/usgoods_\d{2}_/, `usgoods_${code}_`);
}

/** Through FitRoom's own /uniqlo/ proxy: UNIQLO's CDN sends no CORS headers, and the panel reads the pixels. */
const proxied = (origin: string, url: string) => url.replace(/^https:\/\/image\.uniqlo\.com\//, `${origin}/uniqlo/`);

function bodyRanges(item: CatalogItem): Record<string, string> | undefined {
  if (!item.sizeChart) return undefined;
  const out: Record<string, string> = {};
  for (const [size, spec] of Object.entries(item.sizeChart)) {
    const parts = (['chestCm', 'waistCm', 'hipsCm'] as const)
      .map((k) => (spec.body?.[k] ? `${k.replace('Cm', '')} ${spec.body[k]![0]}-${spec.body[k]![1]} cm` : null))
      .filter(Boolean);
    if (parts.length) out[size] = parts.join(', ');
  }
  return Object.keys(out).length ? out : undefined;
}

function summary(item: CatalogItem) {
  return {
    id: item.id,
    name: item.name,
    slot: item.slot,
    kind: item.shape,
    fit: item.fit,
    fabric: item.fabric.replace('_', ' '),
    price_usd: item.salePrice ?? item.price,
    ...(item.salePrice !== null ? { regular_price_usd: item.price } : {}),
    colors: item.colors.map((c) => ({ code: c.code, name: c.name })),
    sizes: Array.isArray(item.sizes) ? item.sizes : [item.sizes],
    size_chart_body: bodyRanges(item),
    url: item.url,
  };
}

// ---- Spaces the panel talks to (its CSP) ----

function spaceOrigin(id: string): string | null {
  const m = id.trim().match(/^([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/);
  return m ? `https://${`${m[1]}-${m[2]}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.hf.space` : null;
}

export function widgetCsp(origin: string, env: NodeJS.ProcessEnv = process.env) {
  const spaces = [env.VITE_TRYON_SPACE ? spaceOrigin(env.VITE_TRYON_SPACE) : null, spaceOrigin(FASHN_SPACE)].filter((s): s is string => Boolean(s));
  return {
    connectDomains: [origin, ...new Set(spaces), 'https://huggingface.co'],
    resourceDomains: [origin],
  };
}

export function widgetHtml(origin: string): string {
  // System fonts and the host's colours (ChatGPT UI guidelines: no custom fonts, no logo; ChatGPT shows ours).
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="${origin}/widget/fitroom-tryon.js"></script></body></html>`;
}

// ---- Tool results ----

type Result = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

const text = (t: string, structured?: Record<string, unknown>, meta?: Record<string, unknown>): Result => ({
  content: [{ type: 'text', text: t }],
  ...(structured ? { structuredContent: structured } : {}),
  ...(meta ? { _meta: meta } : {}),
});

const failure = (t: string, structured?: Record<string, unknown>): Result => ({ ...text(t, structured), isError: true });

/** No linked account where one is needed: an error that makes ChatGPT offer to link FitRoom. */
function linkAccount(origin: string): Result {
  return {
    content: [{ type: 'text', text: 'Sign in to FitRoom to try clothes on (Google account). Each account gets free try-ons.' }],
    _meta: { 'mcp/www_authenticate': [authChallenge(origin)] },
    isError: true,
  };
}

function leftOf(view: AccountView): number | null | undefined {
  return view.user ? view.user.left : undefined;
}

/** What to tell a shopper with no try-ons left: why, and where to read about it. Never a checkout (plugin rules). */
export function noTryOnsText(origin: string, view: AccountView): string {
  const free = view.freeLooks;
  const used = free > 0 ? `This FitRoom account has used its ${free} free try-on${free === 1 ? '' : 's'} and has none left.` : 'This FitRoom account has no try-ons left.';
  return `${used} Trying on another outfit needs more try-ons on the account. How try-ons work: ${origin}/try-ons.html`;
}

const fileSchema = z.object({
  download_url: z.string(),
  file_id: z.string(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

const pick = z.object({
  id: z.string().describe('Item id from find_clothes, e.g. "E453754-000".'),
  color: z.string().optional().describe('Colour code ("67") or name ("Blue") from find_clothes; default the first colour.'),
});

/** Downloads a ChatGPT file for the panel (fallback when the panel can't fetch it itself). Public HTTPS images only. */
export async function downloadPhoto(url: string): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Bad photo address.' };
  }
  const host = parsed.hostname;
  if (parsed.protocol !== 'https:' || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, error: 'Bad photo address.' };
  }
  try {
    const res = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(PHOTO_FETCH_MS) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) return { ok: false, error: `Couldn't load the photo (HTTP ${res.status}).` };
    if (!type.startsWith('image/')) return { ok: false, error: "That file isn't a photo." };
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > MAX_PHOTO_BYTES) return { ok: false, error: 'That photo is too large.' };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'That photo is too large.' };
    return { ok: true, dataUrl: `data:${type.split(';')[0]};base64,${bytes.toString('base64')}` };
  } catch (err: unknown) {
    return { ok: false, error: `Couldn't load the photo (${err instanceof Error ? err.name : 'network'}).` };
  }
}

/** A stable, opaque profile id for a FitRoom account (never the Google id itself). */
export const profileId = (sub: string) => `fr_${createHash('sha256').update(`fitroom-profile:${sub}`).digest('base64url').slice(0, 22)}`;

export function createFitRoomServer(ctx: McpContext): McpServer {
  const { origin, config, user } = ctx;
  const billing = config.enabled;
  const who = { config, user };
  const open = billing ? [{ type: 'noauth' }, { type: 'oauth2', scopes: [SCOPE] }] : [{ type: 'noauth' }];
  const signedIn = billing ? [{ type: 'oauth2', scopes: [SCOPE] }] : [{ type: 'noauth' }];
  const needsAccount = () => billing && !user;
  const server = new McpServer({ name: 'fitroom', title: 'FitRoom', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const csp = widgetCsp(origin, ctx.env);

  server.registerResource('fitroom-try-on', WIDGET_URI, { title: 'FitRoom try-on', mimeType: MIME }, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: MIME,
        text: widgetHtml(origin),
        _meta: {
          ui: { prefersBorder: true, domain: origin, csp },
          'openai/widgetDescription': 'Your photo wearing the outfit, the size to buy and how it fits.',
          'openai/widgetCSP': { connect_domains: csp.connectDomains, resource_domains: csp.resourceDomains, redirect_domains: [origin] },
        },
      },
    ],
  }));

  server.registerTool(
    'find_clothes',
    {
      title: 'Find UNIQLO clothes',
      description: "Search FitRoom's UNIQLO men's tees, sweaters and pants: names, prices, colours (codes for try_on), sizes and size-chart body ranges.",
      inputSchema: {
        query: z.string().max(100).optional().describe('Words to match in the name or colour, e.g. "crew neck navy".'),
        slot: z.enum(['top', 'bottom']).optional(),
        kind: z.enum(['tee', 'sweater', 'pants']).optional(),
        max_price_usd: z.number().positive().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: { securitySchemes: open },
    },
    async ({ query, slot, kind, max_price_usd, limit }) => {
      let items: CatalogItem[];
      try {
        items = await loadCatalog(origin);
      } catch (err: unknown) {
        console.error('[mcp] catalog failed', err instanceof Error ? err.message : err);
        return failure("Couldn't load FitRoom's catalogue. Try again in a moment.");
      }
      const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const found = items.filter((i) => {
        if (slot && i.slot !== slot) return false;
        if (kind && i.shape !== kind) return false;
        if (max_price_usd && (i.salePrice ?? i.price) > max_price_usd) return false;
        const hay = `${i.name} ${i.fit} ${i.fabric} ${i.colors.map((c) => c.name).join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const shown = found.slice(0, limit ?? 8).map(summary);
      const lines = shown.map((i) => `${i.id} ${i.name} ($${i.price_usd}), ${i.colors.length} colours`);
      return text(found.length ? `${found.length} found:\n${lines.join('\n')}` : 'Nothing matches; try fewer words.', { items: shown, total: found.length });
    },
  );

  server.registerTool(
    'try_on',
    {
      title: 'Try clothes on your photo',
      description:
        "Shows the shopper's own full-body front photo wearing the chosen top and/or bottoms (their face, body and background kept), with the size to buy. Uses one of their FitRoom try-ons for a new outfit. Call find_clothes first for ids.",
      inputSchema: {
        photo: fileSchema.describe("The shopper's full-body front photo, attached in the chat."),
        top: pick.optional(),
        bottom: pick.optional(),
        height_cm: z.number().min(120).max(230).optional().describe('For the size to buy.'),
        weight_kg: z.number().min(35).max(250).optional().describe('For the size to buy.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: signedIn,
        'openai/fileParams': ['photo'],
        ui: { resourceUri: WIDGET_URI },
        'openai/outputTemplate': WIDGET_URI,
        'openai/toolInvocation/invoking': 'Opening the fitting room…',
        'openai/toolInvocation/invoked': 'Fitting room ready',
      },
    },
    async ({ photo, top, bottom, height_cm, weight_kg }) => {
      if (needsAccount()) return linkAccount(origin);
      if (!top && !bottom) return failure('Choose a top or bottoms to try on (ids from find_clothes).');
      let items: CatalogItem[];
      try {
        items = await loadCatalog(origin);
      } catch {
        return failure("Couldn't load FitRoom's catalogue. Try again in a moment.");
      }
      const outfit = [];
      const full = [];
      for (const [slot, wanted] of [['top', top], ['bottom', bottom]] as const) {
        if (!wanted) continue;
        const item = items.find((i) => i.id.toLowerCase() === wanted.id.trim().toLowerCase());
        if (!item) return failure(`FitRoom doesn't have ${wanted.id}. Use an id from find_clothes.`);
        if (item.slot !== slot) return failure(`${item.name} is ${item.slot === 'top' ? 'a top' : 'bottoms'}, not ${slot === 'top' ? 'a top' : 'bottoms'}.`);
        const color = findColor(item, wanted.color);
        const image = productImage(item, color.code);
        if (!image) return failure(`UNIQLO has no photo of ${item.name} in ${color.name} to try on.`);
        outfit.push({ slot, id: item.id, name: item.name, color: color.name, color_code: color.code, price_usd: item.salePrice ?? item.price, url: item.url });
        full.push({ item, colorCode: color.code, garment: proxied(origin, image) });
      }
      let view: AccountView;
      try {
        view = user && !isExempt(user.email) ? accountView(config, { email: user.email, balance: await ledger().balance(user.sub) }) : accountView(config, user ? { email: user.email, balance: { freeUsed: 0, credits: 0 } } : null);
      } catch {
        view = accountView(config, null);
      }
      const left = leftOf(view);
      const names = outfit.map((o) => `${o.name} in ${o.color}`).join(' with ');
      const note =
        left === 0
          ? noTryOnsText(origin, view)
          : `The FitRoom panel is re-dressing the photo in ${names} (about a minute) and shows the size to buy.${left ? ` Try-ons left: ${left}.` : ''}`;
      return text(
        note,
        { outfit, try_ons_left: left ?? null, body: height_cm && weight_kg ? { height_cm, weight_kg } : null },
        {
          // the panel only (the model never sees _meta): full items for sizing, garment photos, the photo to use
          fitroom: { origin, items: full, photo, body: height_cm && weight_kg ? { heightCm: height_cm, weightKg: weight_kg } : null, account: view, info: `${origin}/try-ons.html` },
        },
      );
    },
  );

  const lookInput = { look: z.string().regex(LOOK_ID_RE).describe('Digest of the photo and outfit, made by the panel.') };
  const appOnly = (scheme: unknown) => ({ securitySchemes: scheme, ui: { visibility: ['app'] }, 'openai/visibility': 'private', 'openai/widgetAccessible': true });

  server.registerTool(
    'charge_look',
    {
      title: 'Use a try-on',
      description: 'Panel only: uses one of the FitRoom try-ons for a new look before it is made (the same look again is free).',
      inputSchema: lookInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly(signedIn),
    },
    async ({ look }) => {
      if (needsAccount()) return linkAccount(origin);
      const admission = await admit(who, look);
      if (!admission.ok) {
        if (admission.code === 'payment' && admission.view) return failure(noTryOnsText(origin, admission.view), { ok: false, reason: 'no_try_ons', account: admission.view });
        if (admission.code === 'signin') return linkAccount(origin);
        return failure(admission.error, { ok: false, reason: 'unavailable' });
      }
      return text(admission.charged ? 'Used one try-on.' : 'No try-on used (already made, or unlimited).', { ok: true, charged: admission.charged, account: admission.view });
    },
  );

  server.registerTool(
    'refund_look',
    {
      title: 'Give back a try-on',
      description: 'Panel only: gives back the try-on of a look that made no photo.',
      inputSchema: lookInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly(signedIn),
    },
    async ({ look }) => {
      if (needsAccount()) return linkAccount(origin);
      const view = await giveBack(who, look);
      return text('Try-on given back.', { ok: true, ...(view ? { account: view } : {}) });
    },
  );

  server.registerTool(
    'fetch_photo',
    {
      title: 'Load the photo',
      description: "Panel only: loads the shopper's attached photo when the panel can't fetch it directly. Never stored.",
      inputSchema: { photo: fileSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ...appOnly(signedIn), 'openai/fileParams': ['photo'] },
    },
    async ({ photo }) => {
      if (needsAccount()) return linkAccount(origin);
      const got = await downloadPhoto(photo.download_url);
      if (!got.ok) return failure(got.error);
      // in _meta: for the panel, never for the model
      return text('Photo loaded.', { ok: true }, { photo: got.dataUrl });
    },
  );

  if (billing) {
    server.registerTool(
      'my_try_ons',
      {
        title: 'Try-ons left',
        description: 'How many try-ons the linked FitRoom account has left.',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: [SCOPE] }] },
      },
      async () => {
        if (!user) return linkAccount(origin);
        try {
          const view = isExempt(user.email)
            ? accountView(config, { email: user.email, balance: { freeUsed: 0, credits: 0 } })
            : accountView(config, { email: user.email, balance: await ledger().balance(user.sub) });
          const left = view.user?.left;
          const msg = left === null ? 'Unlimited try-ons.' : left === 0 ? noTryOnsText(origin, view) : `${left} try-on${left === 1 ? '' : 's'} left.`;
          return text(msg, { try_ons_left: left ?? null, free_try_ons: view.freeLooks, free_used: view.user?.freeUsed ?? 0 });
        } catch {
          return failure("Couldn't check your try-ons. Try again in a moment.");
        }
      },
    );

    server.registerTool(
      'get_profile',
      {
        title: 'FitRoom account',
        description: 'The linked FitRoom account (for telling accounts apart).',
        inputSchema: {},
        outputSchema: { id: z.string(), email: z.string().optional(), nickname: z.string().optional() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: [SCOPE] }], 'openai/profile': true },
      },
      async () => {
        if (!user) return linkAccount(origin);
        const profile = { id: profileId(user.sub), email: user.email, nickname: `FitRoom (${user.email})` };
        return text(JSON.stringify(profile), profile);
      },
    );
  }

  return server;
}
