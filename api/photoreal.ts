// POST /api/photoreal { image: <PNG data URL>, scene, outfit? } -> { image, remaining } | { error }
import { json, readJson } from './_lib/http';
import { buildPrompt, isScene, parseOutfit } from './_lib/photorealPrompt';
import { currentUsage, end, PHOTOREAL_LIMIT, recordUse, tryBegin } from './_lib/rateLimit';

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1.5';
const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB PNG; Vercel caps request bodies at 4.5 MB
const PNG_PREFIX = 'data:image/png;base64,';
const UPSTREAM_TIMEOUT_MS = 110_000;

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string };
}

function buildForm(png: Buffer, prompt: string, model: string): FormData {
  const form = new FormData();
  form.append('model', model);
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'avatar.png');
  form.append('prompt', prompt);
  form.append('input_fidelity', 'high');
  form.append('size', '1024x1536');
  form.append('quality', 'medium');
  form.append('output_format', 'jpeg');
  form.append('output_compression', '90');
  return form;
}

async function callOpenAI(key: string, form: FormData): Promise<{ b64: string } | { error: string }> {
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
      return { error: 'The photo service could not make this image. Try again in a moment.' };
    }
    return { b64 };
  } catch (err: unknown) {
    console.error('[api/photoreal] request failed', err instanceof Error ? err.name : err);
    return { error: 'The photo service took too long. Try again.' };
  }
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: 'Photoreal is not configured on this deployment.' }, 503);

  const usage = currentUsage(request, key);
  if (usage.used >= PHOTOREAL_LIMIT) {
    return json({ error: `You have used all ${PHOTOREAL_LIMIT} photoreal shots. Thanks for trying FitRoom!`, remaining: 0 }, 429);
  }

  const body = await readJson(request);
  const image = typeof body?.image === 'string' ? body.image : '';
  if (!image.startsWith(PNG_PREFIX) || image.length > MAX_IMAGE_CHARS) {
    return json({ error: 'Expected a PNG snapshot under 3 MB.' }, 400);
  }
  const scene = isScene(body?.scene) ? body.scene : 'studio';
  const prompt = buildPrompt(scene, parseOutfit(body?.outfit));
  const png = Buffer.from(image.slice(PNG_PREFIX.length), 'base64');

  if (!tryBegin(usage.ip)) return json({ error: 'A photo is already developing. One moment.' }, 429);
  try {
    const result = await callOpenAI(key, buildForm(png, prompt, process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL));
    // Only successful shots count toward the limit.
    if ('error' in result) return json({ error: result.error, remaining: PHOTOREAL_LIMIT - usage.used }, 502);
    const setCookie = recordUse(usage, key);
    const remaining = PHOTOREAL_LIMIT - usage.used - 1;
    return json({ image: `data:image/jpeg;base64,${result.b64}`, remaining }, 200, { 'Set-Cookie': setCookie });
  } finally {
    end(usage.ip);
  }
}
