// The try-on inside ChatGPT: the shopper's attached photo, re-dressed with each garment in turn on the free Space,
// exactly as on the website (tryon/space.ts, garment.ts, composite.ts), but the look is charged through the MCP server
// (charge_look / refund_look) since the panel can't reach FitRoom's cookies. Every outside call is injected (tests).
import type { AccountView } from '@api/accountTypes';
import type { CatalogItem } from '../catalog/types';
import { lookId } from '../account/lookId';
import type { PreparedPhoto } from '../photos/prepare';
import type { GarmentPhoto } from '../tryon/garment';
import { describeStatus, SpaceError, type TryOnRunner } from '../tryon/space';

export interface ChatFile {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

/** What try_on gives the panel in its result's `_meta.fitroom` (api/_lib/mcpServer.ts). */
export interface PanelData {
  origin: string;
  items: { item: CatalogItem; colorCode: string; garment: string }[];
  photo: ChatFile;
  body: { heightCm: number; weightKg: number } | null;
  account: AccountView;
  info: string;
}

export interface ToolAnswer {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface Deps {
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolAnswer>;
  fetchFn: typeof fetch;
  prepare: (file: File) => Promise<PreparedPhoto>;
  garment: (url: string) => Promise<GarmentPhoto | null>;
  run: TryOnRunner;
  sharpen: (photo: string, result: Blob, fallback: string) => Promise<string>;
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; status: string; startedAt: number }
  | { kind: 'done'; image: string; note?: string }
  /** The account has no try-ons left: why, and the informational page (never a checkout: plugin rules). */
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string; retryable: boolean };

export const answerText = (a: ToolAnswer) => a.content?.find((c) => c.type === 'text')?.text ?? '';

/** Reads `_meta.fitroom` from a try_on result; null if it isn't one. */
export function panelData(result: ToolAnswer | null | undefined): PanelData | null {
  const data = result?._meta?.fitroom as PanelData | undefined;
  return data && Array.isArray(data.items) && data.items.length > 0 && data.photo?.download_url ? data : null;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) throw new Error('not a data URL');
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`;
}

/** The attached photo: fetched here when ChatGPT lets the panel, else through the server's fetch_photo. */
export async function loadPhoto(photo: ChatFile, deps: Pick<Deps, 'callTool' | 'fetchFn'>): Promise<Blob> {
  try {
    const res = await deps.fetchFn(photo.download_url);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.startsWith('image/')) return await res.blob();
  } catch {
    // blocked by the panel's CSP or CORS: ask the server
  }
  const answer = await deps.callTool('fetch_photo', { photo });
  const dataUrl = answer._meta?.photo;
  if (answer.isError || typeof dataUrl !== 'string') throw new SpaceError(answerText(answer) || "Couldn't load your photo from the chat. Attach it again.", true);
  return dataUrlToBlob(dataUrl);
}

const shortName = (item: CatalogItem) => item.name.replace(/^(Washable|Ultra|Supima|Soft)\s+/i, '');

/**
 * One try-on: load and prepare the photo, charge the look, put on each garment, sharpen. Resolves to the final
 * phase; never throws. A look that made no photo is given back; a partial photo keeps the charge (its retry is free).
 */
export async function tryOn(data: PanelData, deps: Deps, onPhase: (p: Phase) => void, signal: AbortSignal): Promise<Phase> {
  const startedAt = Date.now();
  const working = (status: string) => onPhase({ kind: 'working', status, startedAt });
  let look: string | null = null;
  let charged = false;
  let worn = 0;
  let current: Blob | null = null;
  let prepared: PreparedPhoto | null = null;
  try {
    working('Loading your photo…');
    const blob = await loadPhoto(data.photo, deps);
    try {
      prepared = await deps.prepare(new File([blob], data.photo.file_name ?? 'photo.jpg', { type: blob.type || data.photo.mime_type || 'image/jpeg' }));
    } catch (err: unknown) {
      return { kind: 'error', message: err instanceof Error ? err.message : "Couldn't open that photo. Try a JPEG or PNG.", retryable: false };
    }
    look = await lookId([prepared.dataUrl, ...data.items.map((i) => i.garment)]);
    working('Checking your try-ons…');
    const charge = await deps.callTool('charge_look', { look });
    if (charge.isError) {
      if (charge.structuredContent?.reason === 'no_try_ons') return { kind: 'empty', message: answerText(charge) };
      return { kind: 'error', message: answerText(charge) || "Couldn't check your try-ons. Try again.", retryable: true };
    }
    charged = charge.structuredContent?.charged === true;
    current = dataUrlToBlob(prepared.dataUrl);
    for (const { item, garment } of data.items) {
      if (signal.aborted) throw new SpaceError('Cancelled.', true, false, null, true);
      working(`Getting the ${shortName(item)}…`);
      const g = await deps.garment(garment);
      if (!g) throw new SpaceError(`UNIQLO doesn't have a photo of the ${item.name} to try on.`, false);
      working(`Putting on the ${shortName(item)}…`);
      current = await deps.run(current, g.blob, item.slot === 'top' ? 'tops' : 'bottoms', g.type, (s) => working(describeStatus(s)), signal);
      worn += 1;
    }
    working('Finishing…');
    return { kind: 'done', image: await deps.sharpen(prepared.dataUrl, current, await blobToDataUrl(current)) };
  } catch (err: unknown) {
    if (!(err instanceof SpaceError)) console.error('[fitroom] try-on failed', err);
    const e = err instanceof SpaceError ? err : new SpaceError('Something went wrong with the try-on. Try again.', true, false, err instanceof Error ? err.message : null);
    const message = e.quota ? "Hugging Face's free GPU time for your connection is used up. It resets within a day." : e.message;
    if (worn > 0 && current && prepared) {
      const missing = data.items.slice(worn).map((i) => shortName(i.item)).join(' and ');
      return { kind: 'done', image: await deps.sharpen(prepared.dataUrl, current, await blobToDataUrl(current)), note: `Without the ${missing}: ${message}` };
    }
    if (charged && look) await deps.callTool('refund_look', { look }).catch(() => undefined); // made nothing: give it back
    return { kind: 'error', message, retryable: e.retryable && !e.quota };
  }
}
