// Turns an OpenAI images API failure into a message a shopper can act on, plus the real upstream text.

export interface UpstreamFailure {
  /** Plain-language headline for the toast. */
  error: string;
  /** The upstream message (secrets redacted), shown under the headline. */
  detail: string;
  /** Whether trying again could succeed without anyone changing the account. */
  retryable: boolean;
  /** HTTP status this API answers with. */
  status: number;
}

interface OpenAIErrorBody {
  message: string;
  code: string;
  type: string;
}

const MAX_DETAIL = 240;

const MESSAGES = {
  noCredit: 'Photos are paused: the photo service has no image credit right now. Please try again later.',
  busy: 'The photo service is busy right now. Try again in a minute.',
  badKey: 'Photoreal is not set up correctly on this site (the photo service rejected its key).',
  unverified: 'Photoreal is waiting on account verification with the photo service. Please try again later.',
  safety: "The photo service's safety filter declined this one. Try again, or use photos in plain, everyday clothes.",
  badInput: 'The photo service could not read these photos. Try again, or retake them as JPEGs.',
  outage: 'The photo service is having trouble. Try again in a moment.',
  empty: 'The photo service answered with no image. Try again.',
  timeout: 'The photo service took too long. Try again.',
} as const;

const URL_RE = /https?:\/\/\S+/;

/** Keeps whole sentences up to the cap; hard-cuts only a single over-long sentence. */
function fitSentences(sentences: string[]): string {
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > MAX_DETAIL) break;
    out = next;
  }
  if (out || !sentences[0]) return out;
  return `${sentences[0].slice(0, MAX_DETAIL - 1)}…`;
}

/** Removes organization ids, key fragments and links; keeps whole sentences up to the length cap. */
export function redact(message: string): string {
  const clean = message
    .replace(/\borg-[A-Za-z0-9]+/g, 'org-…')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, 'sk-…')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = clean.split(/(?<=\.)\s+/).filter((s) => s && !URL_RE.test(s));
  return fitSentences(sentences);
}

function readError(body: unknown): OpenAIErrorBody {
  const err = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const field = (k: string): string => {
    const v = err && typeof err === 'object' ? (err as Record<string, unknown>)[k] : undefined;
    return typeof v === 'string' ? v : '';
  };
  return { message: field('message'), code: field('code'), type: field('type') };
}

function failure(error: string, retryable: boolean, status: number, detail: string): UpstreamFailure {
  return { error, retryable, status, detail };
}

function classify429(e: OpenAIErrorBody, detail: string): UpstreamFailure {
  const noCredit = e.code === 'insufficient_quota' || /\bLimit 0\b/.test(e.message) || /billing/i.test(e.message);
  return noCredit ? failure(MESSAGES.noCredit, false, 503, detail) : failure(MESSAGES.busy, true, 503, detail);
}

/** Classifies a non-image response from the OpenAI images API. */
export function describeUpstreamError(httpStatus: number, body: unknown): UpstreamFailure {
  const e = readError(body);
  const detail = e.message ? redact(e.message) : `HTTP ${httpStatus}`;
  if (httpStatus >= 200 && httpStatus < 300) return failure(MESSAGES.empty, true, 502, detail);
  if (httpStatus === 429) return classify429(e, detail);
  if (httpStatus === 401 || e.code === 'invalid_api_key') return failure(MESSAGES.badKey, false, 503, detail);
  if (httpStatus === 403 && /verif/i.test(e.message)) return failure(MESSAGES.unverified, false, 503, detail);
  if (e.code === 'moderation_blocked' || /safety/i.test(e.message)) return failure(MESSAGES.safety, true, 422, detail);
  if (httpStatus >= 400 && httpStatus < 500) return failure(MESSAGES.badInput, true, 502, detail);
  return failure(MESSAGES.outage, true, 502, detail);
}

export function describeTimeout(): UpstreamFailure {
  return failure(MESSAGES.timeout, true, 504, 'No answer within the time limit.');
}

export function describeNetworkError(name: string): UpstreamFailure {
  return failure(MESSAGES.outage, true, 502, `Request failed (${name}).`);
}
