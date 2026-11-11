// Try-on photos for the ChatGPT plugin, made on the server with the FASHN API (tryon-v1.6, about 8 s and 1 credit
// per garment). The shopper's photo arrives as a ChatGPT file link; it is downloaded into memory, sent to FASHN as a
// data URI with `return_base64` (FASHN keeps no copy of either beyond the request: docs.fashn.ai, Data Retention),
// and the result goes back to the widget only. FitRoom stores and logs neither photo.
// Each garment is one pass: the top on the shopper's photo, then the bottoms on that result (as the web app does).
import { productImage } from '../../../web/src/catalog/types';
import type { CatalogItem } from '../uniqlo';

type Env = Record<string, string | undefined>;

export const FASHN_URL = 'https://api.fashn.ai/v1';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 10_000;
const GARMENT_TIMEOUT_MS = 6_000;
const POLL_MS = 1_500;
const MAX_REDIRECTS = 3;

export interface TryOnDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultDeps: TryOnDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
};

export type TryOnFailure = {
  ok: false;
  /** photo: fix the photo; busy / error: try again; unavailable: not today. */
  kind: 'photo' | 'busy' | 'error' | 'unavailable';
  message: string;
};

export function tryOnStatus(env: Env = process.env): { on: true; key: string } | { on: false; message: string } {
  if (env.TRYON_DISABLED === '1') return { on: false, message: 'Try-on photos are paused right now. Size advice still works.' };
  const key = env.FASHN_API_KEY?.trim();
  if (!key) return { on: false, message: "Try-on photos aren't switched on for FitRoom in ChatGPT yet. Size advice works." };
  return { on: true, key };
}

/** A ChatGPT file reference ({ download_url, ... }) or a plain https URL -> the URL, or null. */
export function photoUrl(ref: unknown): string | null {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && typeof (ref as { download_url?: unknown }).download_url === 'string') {
    return (ref as { download_url: string }).download_url;
  }
  return null;
}

/** Only public https hosts: no IP literals, localhost or internal names (the URL comes from the caller). */
export function safePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null;
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  return url;
}

function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > max ? null : buf;
}

/** Downloads an image into memory (following up to 3 redirects, each checked) as a data URI. */
export async function fetchImage(
  raw: string,
  deps: TryOnDeps,
  timeoutMs: number,
): Promise<{ ok: true; dataUrl: string } | { ok: false; reason: 'url' | 'http' | 'size' | 'type' | 'network' }> {
  let url = safePublicUrl(raw);
  if (!url) return { ok: false, reason: 'url' };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await deps.fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = safePublicUrl(new URL(res.headers.get('location')!, url).toString());
        if (!url) return { ok: false, reason: 'url' };
        continue;
      }
      if (!res.ok) return { ok: false, reason: 'http' };
      const bytes = await readCapped(res, MAX_PHOTO_BYTES);
      if (!bytes) return { ok: false, reason: 'size' };
      const type = sniffImage(bytes);
      if (!type) return { ok: false, reason: 'type' };
      return { ok: true, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString('base64')}` };
    }
    return { ok: false, reason: 'url' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function fetchShopperPhoto(ref: unknown, deps: TryOnDeps): Promise<{ ok: true; dataUrl: string } | TryOnFailure> {
  const raw = photoUrl(ref);
  if (!raw) return { ok: false, kind: 'photo', message: 'Attach a full-body photo of yourself to try clothes on.' };
  const res = await fetchImage(raw, deps, PHOTO_TIMEOUT_MS);
  if (res.ok) return res;
  const messages: Record<typeof res.reason, string> = {
    url: "That photo link can't be opened. Attach the photo to the chat again.",
    http: "That photo couldn't be downloaded. Attach it to the chat again.",
    size: 'That photo is over 10 MB. Send a smaller one.',
    type: 'Send the photo as a JPEG, PNG or WebP image.',
    network: "That photo couldn't be downloaded. Attach it to the chat again.",
  };
  return { ok: false, kind: 'photo', message: messages[res.reason] };
}

/**
 * UNIQLO's garment-only shot for a catalogue photo URL (same rule as web/src/tryon/garment.ts garmentOnlyUrl, which
 * can't be imported here: its module types need the browser build; a test keeps the two in step):
 * .../UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg -> .../UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg
 */
export function garmentOnlyUrl(url: string): string | null {
  const m = url.match(/^(.*\/UQ\/ST3\/)us(\/imagesgoods\/\d+\/item\/)usgoods_([A-Za-z0-9]+_\d+_3x4\.jpg)$/);
  return m ? `${m[1]}WesternCommon${m[2]}goods_${m[3]}` : null;
}

/**
 * The garment photo FASHN copies: UNIQLO's garment-only shot (goods_*) when it exists, else the catalogue photo, which
 * is worn by a model whose styling (an undershirt, a tuck) the try-on tends to copy (see CLAUDE.md, Photo engines).
 */
export async function fetchGarmentPhoto(item: CatalogItem, colorCode: string, deps: TryOnDeps): Promise<string | null> {
  const catalogue = productImage(item, colorCode);
  if (!catalogue) return null;
  const candidates = [garmentOnlyUrl(catalogue), catalogue].filter((u): u is string => Boolean(u));
  for (const url of candidates) {
    const res = await fetchImage(url, deps, GARMENT_TIMEOUT_MS);
    if (res.ok) return res.dataUrl;
  }
  return null;
}

interface StatusReply {
  status?: string;
  output?: unknown;
  error?: { name?: string; message?: string } | null;
}

function runtimeFailure(name: string | undefined): TryOnFailure {
  switch (name) {
    case 'PoseError':
      return { ok: false, kind: 'photo', message: "Couldn't find your body in that photo. Use a well-lit photo of you standing, head to toe." };
    case 'ImageLoadError':
      return { ok: false, kind: 'photo', message: "Couldn't read that photo. Try another JPEG or PNG." };
    case 'ContentModerationError':
      return { ok: false, kind: 'photo', message: "That photo can't be used for try-on. Use a photo of yourself, dressed, standing." };
    case 'UnavailableError':
    case 'ThirdPartyError':
      return { ok: false, kind: 'busy', message: 'The try-on service is busy. Try again in a minute.' };
    default:
      return { ok: false, kind: 'error', message: 'The try-on photo failed. Try again.' };
  }
}

/** One FASHN pass: `garment` on `person` (both data URIs). Gives up at `deadline` (ms since epoch). */
export async function fashnPass(
  person: string,
  garment: string,
  category: 'tops' | 'bottoms',
  key: string,
  deps: TryOnDeps,
  deadline: number,
): Promise<{ ok: true; image: string } | TryOnFailure> {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let id: string;
  try {
    const res = await deps.fetch(`${FASHN_URL}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model_name: 'tryon-v1.6',
        inputs: {
          model_image: person,
          garment_image: garment,
          category,
          garment_photo_type: 'auto',
          mode: 'balanced',
          moderation_level: 'conservative',
          output_format: 'jpeg',
          return_base64: true,
        },
      }),
      signal: AbortSignal.timeout(Math.max(1000, Math.min(15_000, deadline - deps.now()))),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
    if (!res.ok || typeof body.id !== 'string') {
      console.error('[mcp] fashn run failed', res.status, typeof body.error === 'string' ? body.error : '');
      if (res.status === 429 && body.error === 'OutOfCredits') return { ok: false, kind: 'unavailable', message: 'Try-on photos are paused for today.' };
      if (res.status === 429) return { ok: false, kind: 'busy', message: 'Lots of try-ons right now. Try again in a minute.' };
      if (res.status === 401) return { ok: false, kind: 'unavailable', message: "Try-on photos aren't working right now." };
      return { ok: false, kind: 'error', message: 'The try-on photo failed. Try again.' };
    }
    id = body.id;
  } catch {
    return { ok: false, kind: 'busy', message: "The try-on service didn't answer. Try again in a minute." };
  }
  while (deps.now() < deadline) {
    await deps.sleep(POLL_MS);
    let reply: StatusReply;
    try {
      const res = await deps.fetch(`${FASHN_URL}/status/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429 || res.status >= 500) continue;
      reply = (await res.json()) as StatusReply;
    } catch {
      continue;
    }
    if (reply.status === 'completed') {
      const first = Array.isArray(reply.output) ? reply.output[0] : null;
      if (typeof first === 'string' && first.startsWith('data:image/')) return { ok: true, image: first };
      return { ok: false, kind: 'error', message: 'The try-on photo failed. Try again.' };
    }
    if (reply.status === 'failed') {
      console.error('[mcp] fashn prediction failed', reply.error?.name ?? 'unknown');
      return runtimeFailure(reply.error?.name);
    }
  }
  return { ok: false, kind: 'busy', message: 'The try-on took too long. Try again in a minute.' };
}

export interface Garment {
  item: CatalogItem;
  colorCode: string;
}

export type TryOnResult =
  | { ok: true; image: string; done: Garment[]; failed?: { garment: Garment; failure: TryOnFailure } }
  | TryOnFailure;

/** The whole outfit on the shopper's photo: top first, then the bottoms on that result. A failed second pass keeps the first. */
export async function tryOnOutfit(photo: string, garments: Garment[], key: string, deps: TryOnDeps, deadline: number): Promise<TryOnResult> {
  const ordered = [...garments].sort((a, b) => (a.item.slot === 'top' ? -1 : 1) - (b.item.slot === 'top' ? -1 : 1));
  let person = photo;
  const done: Garment[] = [];
  for (const g of ordered) {
    const garment = await fetchGarmentPhoto(g.item, g.colorCode, deps);
    const pass: { ok: true; image: string } | TryOnFailure = garment
      ? await fashnPass(person, garment, g.item.slot === 'top' ? 'tops' : 'bottoms', key, deps, deadline)
      : { ok: false, kind: 'error', message: `UNIQLO's photo of the ${g.item.name} couldn't be loaded. Try again.` };
    if (!pass.ok) {
      if (done.length === 0) return pass;
      return { ok: true, image: person, done, failed: { garment: g, failure: pass } };
    }
    person = pass.image;
    done.push(g);
  }
  return { ok: true, image: person, done };
}
