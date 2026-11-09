// POST /api/photoreal: one photograph (one view) of the shopper wearing a look. Contract: api/_lib/look.ts.
//   { view, scene, body, items, photos: { front, side, face }, reference?, lookToken? }
//   -> { image, view, lookToken?, remaining } | { error, detail?, retryable, remaining? }
// The front shot costs one look and returns a lookToken; three-quarter, side and back send it back with the front
// shot as `reference`, so all four photos show the same person, outfit, shoes and light.
// Photos are passed straight to the image model and never stored or logged.
import { json, readJson } from './_lib/http';
import { extension, fetchProductImage, decodeDataUrl, type ImageInput } from './_lib/images';
import { parseLookRequest, type LookRequest } from './_lib/look';
import { angleAllowed, issueLookToken, lookDigest, recordAngle, verifyLookToken } from './_lib/lookToken';
import { buildLookPrompt } from './_lib/photorealPrompt';
import { begin, check, currentUsage, end, lookCookie, looksLeft, recordImage } from './_lib/rateLimit';
import { describeNetworkError, describeTimeout, describeUpstreamError, type UpstreamFailure } from './_lib/upstreamError';

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1.5';
const DEFAULT_QUALITY = 'medium';
const UPSTREAM_TIMEOUT_MS = 110_000;
const LOG_BODY_CHARS = 1_000; // full upstream error in the function logs

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
}

type Upstream = { b64: string } | (UpstreamFailure & { billable: boolean });

export function buildForm(images: ImageInput[], prompt: string, model: string, quality: string): FormData {
  const form = new FormData();
  form.append('model', model);
  // Order matters: the prompt names them "Image 1..n", and high input fidelity favours the first (the front photo).
  images.forEach((img, i) => form.append('image[]', new Blob([img.bytes], { type: img.mime }), `ref${i + 1}.${extension(img.mime)}`));
  form.append('prompt', prompt);
  form.append('input_fidelity', 'high');
  form.append('size', '1024x1536');
  form.append('quality', quality);
  form.append('output_format', 'jpeg');
  form.append('output_compression', '88');
  return form;
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function callOpenAI(key: string, form: FormData): Promise<Upstream> {
  try {
    const res = await fetch(OPENAI_EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const data = await readBody(res);
    const b64 = (data as OpenAIImageResponse | null)?.data?.[0]?.b64_json;
    if (res.ok && b64) return { b64 };
    console.error('[api/photoreal] OpenAI error', res.status, JSON.stringify(data).slice(0, LOG_BODY_CHARS));
    return { ...describeUpstreamError(res.status, data), billable: false };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'unknown';
    console.error('[api/photoreal] request failed', name);
    // A timeout may still be billed upstream, so it counts toward the IP and daily limits.
    if (name === 'TimeoutError') return { ...describeTimeout(), billable: true };
    return { ...describeNetworkError(name), billable: false };
  }
}

/** Photos in prompt order: front, side, face, [finished front shot], [top product], [bottoms product]. */
async function gatherImages(req: LookRequest): Promise<{ images: ImageInput[]; products: ('top' | 'bottom')[] }> {
  const own = [req.photos.front, req.photos.side, req.photos.face, ...(req.reference ? [req.reference] : [])].map(decodeDataUrl);
  const fetched = await Promise.all(req.items.map(async (p) => ({ slot: p.slot, img: p.image ? await fetchProductImage(p.image) : null })));
  const products = fetched.filter((f): f is { slot: 'top' | 'bottom'; img: ImageInput } => f.img !== null);
  return {
    images: [...own.filter((i): i is ImageInput => i !== null), ...products.map((p) => p.img)],
    products: products.map((p) => p.slot),
  };
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[api/photoreal] OPENAI_API_KEY is not set');
    return json({ error: 'Photos are not configured on this deployment.', retryable: false }, 503);
  }

  const usage = currentUsage(request, key);
  const parsed = parseLookRequest(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error, retryable: false, remaining: looksLeft(usage) }, 400);
  const req = parsed.value;
  const newLook = req.view === 'front';

  let lookId: string | null = null;
  if (!newLook) {
    lookId = verifyLookToken(req.lookToken, key, lookDigest(req));
    if (!lookId) return json({ error: 'This look has expired or changed. Make the shots again.', retryable: false, remaining: looksLeft(usage) }, 403);
    const angle = angleAllowed(lookId, req.view);
    if (!angle.ok) return json({ error: angle.error, retryable: false, remaining: looksLeft(usage) }, angle.status);
  }

  const verdict = check(usage, newLook);
  if (!verdict.ok) return json({ error: verdict.error, retryable: false, remaining: looksLeft(usage) }, verdict.status);

  begin(usage.ip);
  try {
    const { images, products } = await gatherImages(req);
    const prompt = buildLookPrompt({ ...req, roles: { reference: Boolean(req.reference), products } });
    const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;
    const quality = process.env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY;
    const result = await callOpenAI(key, buildForm(images, prompt, model, quality));

    if ('error' in result) {
      const { billable, status, ...failure } = result;
      if (billable) {
        recordImage(usage.ip);
        if (lookId) recordAngle(lookId, req.view, false);
      }
      return json({ ...failure, remaining: looksLeft(usage) }, status);
    }

    recordImage(usage.ip);
    const image = `data:image/jpeg;base64,${result.b64}`;
    if (lookId) {
      recordAngle(lookId, req.view, true);
      return json({ image, view: req.view, remaining: looksLeft(usage) });
    }
    return json(
      { image, view: req.view, lookToken: issueLookToken(key, lookDigest(req)), remaining: looksLeft({ ...usage, looks: usage.looks + 1 }) },
      200,
      { 'Set-Cookie': lookCookie(usage, key) },
    );
  } finally {
    end(usage.ip);
  }
}
