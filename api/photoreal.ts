// POST /api/photoreal { image: <JPEG/PNG data URL, max 1024px>, scene, items? }
//   -> { image, remaining } | { error, detail?, retryable, remaining? }
import { json, readJson } from './_lib/http';
import { buildPrompt, isScene, parseItems } from './_lib/photorealPrompt';
import { begin, check, currentUsage, end, PHOTOREAL_LIMIT, recordUse } from './_lib/rateLimit';
import { describeNetworkError, describeTimeout, describeUpstreamError, type UpstreamFailure } from './_lib/upstreamError';

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1.5';
const MAX_IMAGE_CHARS = 2_800_000; // ~2 MB decoded; far under Vercel's 4.5 MB request cap
const DATA_URL_RE = /^data:image\/(png|jpeg);base64,/;
const UPSTREAM_TIMEOUT_MS = 110_000;
const LOG_BODY_CHARS = 1_000; // full upstream error in the function logs

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
}

type Upstream = { b64: string } | (UpstreamFailure & { billable: boolean });

function buildForm(bytes: Buffer, mime: string, prompt: string, model: string): FormData {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const form = new FormData();
  form.append('model', model);
  form.append('image', new Blob([new Uint8Array(bytes)], { type: mime }), `avatar.${ext}`);
  form.append('prompt', prompt);
  form.append('input_fidelity', 'high');
  form.append('size', '1024x1536');
  form.append('quality', 'medium');
  form.append('output_format', 'jpeg');
  form.append('output_compression', '90');
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
    const failure = describeUpstreamError(res.status, data);
    console.error('[api/photoreal] OpenAI error', res.status, JSON.stringify(data).slice(0, LOG_BODY_CHARS));
    return { ...failure, billable: false };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'unknown';
    console.error('[api/photoreal] request failed', name);
    // A timeout may still be billed upstream, so it counts toward the visitor's limit.
    if (name === 'TimeoutError') return { ...describeTimeout(), billable: true };
    return { ...describeNetworkError(name), billable: false };
  }
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[api/photoreal] OPENAI_API_KEY is not set');
    return json({ error: 'Photoreal is not configured on this deployment.', retryable: false }, 503);
  }

  const usage = currentUsage(request, key);
  const verdict = check(usage);
  if (!verdict.ok) {
    return json({ error: verdict.error, retryable: false, remaining: PHOTOREAL_LIMIT - usage.used }, verdict.status);
  }

  const body = await readJson(request);
  const image = typeof body?.image === 'string' ? body.image : '';
  const match = image.match(DATA_URL_RE);
  if (!match || image.length > MAX_IMAGE_CHARS) {
    return json({ error: 'Expected a JPEG or PNG snapshot under 2 MB.', retryable: false }, 400);
  }

  const scene = isScene(body?.scene) ? body.scene : 'studio';
  const prompt = buildPrompt(scene, parseItems(body?.items));
  const bytes = Buffer.from(image.slice(match[0].length), 'base64');
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;

  begin(usage.ip);
  try {
    const result = await callOpenAI(key, buildForm(bytes, `image/${match[1]}`, prompt, model));
    if ('error' in result) {
      const { billable, status, ...failure } = result;
      const headers: Record<string, string> = billable ? { 'Set-Cookie': recordUse(usage, key) } : {};
      const remaining = PHOTOREAL_LIMIT - usage.used - (billable ? 1 : 0);
      return json({ ...failure, remaining }, status, headers);
    }
    const setCookie = recordUse(usage, key);
    return json(
      { image: `data:image/jpeg;base64,${result.b64}`, remaining: PHOTOREAL_LIMIT - usage.used - 1 },
      200,
      { 'Set-Cookie': setCookie },
    );
  } finally {
    end(usage.ip);
  }
}
