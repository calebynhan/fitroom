// Image inputs for the photo model: shopper photos arrive as data URLs; product photos are fetched from UNIQLO's
// image CDN (and only from there: the URL pattern is checked again here, and redirects are refused).
import { PHOTO_DATA_URL_RE, PRODUCT_IMAGE_RE } from './look';

export interface ImageInput {
  bytes: Uint8Array<ArrayBuffer>;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

const MAX_PRODUCT_BYTES = 4_000_000;
const PRODUCT_TIMEOUT_MS = 8_000;
const MIME_RE = /^image\/(jpeg|png|webp)\b/;

export function decodeDataUrl(dataUrl: string): ImageInput | null {
  const m = dataUrl.match(PHOTO_DATA_URL_RE);
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  return bytes.byteLength > 0 ? { bytes, mime: `image/${m[1]}` as ImageInput['mime'] } : null;
}

/** The product photo, or null if it can't be fetched (the prompt then describes the garment in words). */
export async function fetchProductImage(url: string, fetcher: typeof fetch = fetch): Promise<ImageInput | null> {
  if (!PRODUCT_IMAGE_RE.test(url)) return null;
  try {
    const res = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(PRODUCT_TIMEOUT_MS) });
    const type = res.headers.get('content-type') ?? '';
    const mime = type.match(MIME_RE);
    if (!res.ok || !mime || Number(res.headers.get('content-length') ?? 0) > MAX_PRODUCT_BYTES) {
      console.warn('[api/photoreal] product photo skipped', res.status, type);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PRODUCT_BYTES) return null;
    return { bytes, mime: `image/${mime[1]}` as ImageInput['mime'] };
  } catch (err: unknown) {
    console.warn('[api/photoreal] product photo failed', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

export function extension(mime: ImageInput['mime']): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}
