// POST /api/photoreal { image: <PNG or JPEG data URL>, scene, outfit? } -> { image, remaining } | { error }
import { json, readJson } from './_lib/http';
import { buildPrompt, isScene, parseOutfit } from './_lib/photorealPrompt';
import { begin, check, currentUsage, end, PHOTOREAL_LIMIT, recordUse } from './_lib/rateLimit';

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1.5';
const MAX_IMAGE_CHARS = 4_000_000; // stays under Vercel's 4.5 MB request cap
const DATA_URL_RE = /^data:image\/(png|jpeg);base64,/;
const UPSTREAM_TIMEOUT_MS = 110_000;

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string };
}

type Upstream = { b64: string } | { error: string; billable: boolean };

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

async function callOpenAI(key: string, form: FormData): Promise<Upstream> {
  try {
    const res = await fetch(OPENAI_EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const data = (await res.json()) as OpenAIImageResponse;
    const b64 = data.data?.[0]?.b64_json;
    if (!res.ok || !b64) {
      console.error('[api/photoreal] OpenAI error', res.status, data.error?.message);
      return { error: 'The photo service could not make this image. Try again in a moment.', billable: false };
    }
    return { b64 };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'unknown';
    console.error('[api/photoreal] request failed', name);
    // A timeout may still be billed upstream, so it counts toward the visitor's limit.
    return { error: 'The photo service took too long. Try again.', billable: name === 'TimeoutError' };
  }
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: 'Photoreal is not configured on this deployment.' }, 503);

  const usage = currentUsage(request, key);
  const verdict = check(usage);
  if (!verdict.ok) return json({ error: verdict.error, remaining: PHOTOREAL_LIMIT - usage.used }, verdict.status);

  const body = await readJson(request);
  const image = typeof body?.image === 'string' ? body.image : '';
  const match = image.match(DATA_URL_RE);
  if (!match || image.length > MAX_IMAGE_CHARS) return json({ error: 'Expected a PNG or JPEG snapshot under 3 MB.' }, 400);

  const scene = isScene(body?.scene) ? body.scene : 'studio';
  const prompt = buildPrompt(scene, parseOutfit(body?.outfit));
  const bytes = Buffer.from(image.slice(match[0].length), 'base64');
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;

  begin(usage.ip);
  try {
    const result = await callOpenAI(key, buildForm(bytes, `image/${match[1]}`, prompt, model));
    if ('error' in result) {
      const headers: Record<string, string> = result.billable ? { 'Set-Cookie': recordUse(usage, key) } : {};
      const remaining = PHOTOREAL_LIMIT - usage.used - (result.billable ? 1 : 0);
      return json({ error: result.error, remaining }, 502, headers);
    }
    const setCookie = recordUse(usage, key);
    return json({ image: `data:image/jpeg;base64,${result.b64}`, remaining: PHOTOREAL_LIMIT - usage.used - 1 }, 200, { 'Set-Cookie': setCookie });
  } finally {
    end(usage.ip);
  }
}
