// POST /api/photoreal: one photograph (one view) of the shopper wearing a look. Contract: api/_lib/look.ts.
//   { view, scene, body, items, photos: { front, side, face }, reference?, lookToken? }
//   -> { image, view, lookToken?, remaining } | { error, detail?, retryable, remaining? }
// The front shot costs one look and returns a lookToken; three-quarter, side and back send it back with the front
// shot as `reference`, so all four photos show the same person, outfit, shoes and light. A size comparison (front
// view + `compare`) sends it too: the same front shot with one item in another size, at no extra look.
// Photos are passed straight to the image model and never stored or logged.
// Paid try-ons on (billing.ts): a new look needs a signed-in person with a look left (401 / 402 with `code` otherwise),
// charged before the shot and given back if it fails; the per-visitor cookie limit is off. Responses carry `account`.
import { admit, asker, giveBack } from './_lib/account';
import type { AccountView } from './_lib/billing';
import { json, readJson } from './_lib/http';
import { extension, fetchProductImage, decodeDataUrl, type ImageInput } from './_lib/images';
import { comparedItems, parseLookRequest, type LookRequest } from './_lib/look';
import { claimAngle, issueLookToken, lookDigest, settleAngle, shotKey, verifyLookToken, type AngleOutcome } from './_lib/lookToken';
import { buildLookPrompt } from './_lib/photorealPrompt';
import { begin, check, currentUsage, end, lookCookie, looksLeft, recordImage } from './_lib/rateLimit';
import { describeNetworkError, describeTimeout, describeUpstreamError, type UpstreamFailure } from './_lib/upstreamError';

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1.5';
const DEFAULT_QUALITY = 'medium';
// vercel.json gives this function 120 s; the OpenAI call gets what is left of this budget (at least 15 s).
const FUNCTION_BUDGET_MS = 112_000;
const MIN_UPSTREAM_MS = 15_000;
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

async function callOpenAI(key: string, form: FormData, timeoutMs: number): Promise<Upstream> {
  try {
    const res = await fetch(OPENAI_EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
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

/**
 * Photos in prompt order: front, side, face, [finished front shot], [top product], [bottoms product]. A size
 * comparison edits the finished front shot, so it leads (high input fidelity favours the first image).
 */
async function gatherImages(req: LookRequest): Promise<{ images: ImageInput[]; products: ('top' | 'bottom')[] }> {
  const photos = [req.photos.front, req.photos.side, req.photos.face];
  const ordered = req.reference ? (req.compare ? [req.reference, ...photos] : [...photos, req.reference]) : photos;
  const own = ordered.map(decodeDataUrl);
  const fetched = await Promise.all(req.items.map(async (p) => ({ slot: p.slot, img: p.image ? await fetchProductImage(p.image) : null })));
  const products = fetched.filter((f): f is { slot: 'top' | 'bottom'; img: ImageInput } => f.img !== null);
  return {
    images: [...own.filter((i): i is ImageInput => i !== null), ...products.map((p) => p.img)],
    products: products.map((p) => p.slot),
  };
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[api/photoreal] OPENAI_API_KEY is not set');
    return json({ error: 'Photos are not configured on this deployment.', retryable: false }, 503);
  }

  const usage = currentUsage(request, key);
  const who = asker(request);
  const billing = who.config.enabled;
  const parsed = parseLookRequest(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error, retryable: false, remaining: looksLeft(usage) }, 400);
  const req = parsed.value;
  const newLook = req.view === 'front' && !req.compare;
  const shot = shotKey(req.view, req.compare);

  let lookId: string | null = null;
  if (!newLook) {
    lookId = verifyLookToken(req.lookToken, key, lookDigest(req));
    if (!lookId) return json({ error: 'This look has expired or changed. Shoot it again.', retryable: false, remaining: looksLeft(usage) }, 403);
  }

  const verdict = check(usage, newLook, !billing);
  if (!verdict.ok) {
    const headers: Record<string, string> = verdict.retryAfterS ? { 'Retry-After': String(verdict.retryAfterS) } : {};
    return json({ error: verdict.error, retryable: verdict.retryable, remaining: looksLeft(usage) }, verdict.status, headers);
  }

  // A new look costs one of the person's looks (the same look again costs nothing); server-made ids carry a ':' so
  // the browser's refund endpoint can't name them.
  const chargedLook = newLook && billing ? `p:${lookDigest(req)}` : null;
  let account: AccountView | undefined;
  let charged = false;
  if (chargedLook) {
    const admission = await admit(who, chargedLook);
    if (!admission.ok) {
      return json({ error: admission.error, code: admission.code, retryable: admission.code === 'unavailable', account: admission.view, remaining: looksLeft(usage) }, admission.status);
    }
    account = admission.view;
    charged = admission.charged;
  }
  if (lookId) {
    const angle = claimAngle(lookId, shot);
    if (!angle.ok) return json({ error: angle.error, retryable: angle.retryable, remaining: looksLeft(usage) }, angle.status);
  }

  let outcome: AngleOutcome = 'free';
  begin(usage.ip);
  try {
    const { images, products } = await gatherImages(req);
    const from = req.compare && req.items.find((p) => p.slot === req.compare?.slot)?.size;
    const compare = req.compare && from ? { slot: req.compare.slot, from, to: req.compare.size, delta: req.compare.delta } : undefined;
    const items = comparedItems(req.items, req.compare);
    const prompt = buildLookPrompt({ ...req, items, roles: { reference: Boolean(req.reference), products, compare } });
    const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;
    const quality = process.env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY;
    const timeoutMs = Math.max(MIN_UPSTREAM_MS, FUNCTION_BUDGET_MS - (Date.now() - started));
    const result = await callOpenAI(key, buildForm(images, prompt, model, quality), timeoutMs);

    if ('error' in result) {
      const { billable, status, ...failure } = result;
      if (billable) {
        recordImage(usage.ip);
        outcome = 'billed';
      }
      if (charged && chargedLook) account = (await giveBack(who, chargedLook)) ?? account;
      charged = false;
      return json({ ...failure, remaining: looksLeft(usage), ...(account ? { account } : {}) }, status);
    }

    recordImage(usage.ip);
    outcome = 'done';
    const image = `data:image/jpeg;base64,${result.b64}`;
    if (req.compare) {
      const echo = { slot: req.compare.slot, size: req.compare.size };
      return json({ image, view: req.view, compare: echo, remaining: looksLeft(usage) });
    }
    if (lookId) return json({ image, view: req.view, remaining: looksLeft(usage) });
    const lookToken = issueLookToken(key, lookDigest(req));
    // Paid try-ons count looks in the ledger, not the cookie.
    if (billing) return json({ image, view: req.view, lookToken, remaining: looksLeft(usage), ...(account ? { account } : {}) });
    return json({ image, view: req.view, lookToken, remaining: looksLeft({ ...usage, looks: usage.looks + 1 }) }, 200, {
      'Set-Cookie': lookCookie(usage, key),
    });
  } finally {
    if (lookId) settleAngle(lookId, shot, outcome);
    // a crash after the charge must not cost the person a look
    if (charged && outcome !== 'done' && chargedLook) await giveBack(who, chargedLook);
    end(usage.ip);
  }
}
