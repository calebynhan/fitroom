// The free try-on engine: FASHN VTON v1.5 (Apache-2.0) on its official Hugging Face Space, called straight from the
// shopper's browser. It repaints only the clothing in their own photo, so their face, body, pose and background stay
// theirs. Free: Hugging Face's ZeroGPU runs it, within a per-visitor daily allowance; the Space handles one try-on at
// a time for everyone, with a queue of up to 30.

export interface SpaceRef {
  /** "owner/name" on Hugging Face. */
  id: string;
  /** The Space's own URL (connecting by URL skips a huggingface.co metadata lookup). */
  url: string;
  /** Its page on huggingface.co (linked from the privacy notes). */
  page: string;
}

export const FASHN_SPACE = 'fashn-ai/fashn-vton-1.5';

/** "owner/name" -> its URLs. Hugging Face serves a Space at <owner>-<name>.hf.space, lowercase, other characters as "-". */
export function spaceRef(id: string): SpaceRef | null {
  const m = id.trim().match(/^(?:https:\/\/huggingface\.co\/spaces\/)?([\w.-]+)\/([\w.-]+?)\/?$/);
  if (!m) return null;
  const host = `${m[1]}-${m[2]}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return { id: `${m[1]}/${m[2]}`, url: `https://${host}.hf.space/`, page: `https://huggingface.co/spaces/${m[1]}/${m[2]}` };
}

/**
 * The Spaces to try, in order: VITE_TRYON_SPACE (our own duplicate: our own queue, no dependency on FASHN keeping its
 * demo up) when set, then FASHN's official one as the fallback when ours can't be reached.
 */
export function spaceList(configured: string | undefined): SpaceRef[] {
  const own = configured ? spaceRef(configured) : null;
  const fashn = spaceRef(FASHN_SPACE)!;
  return own && own.id.toLowerCase() !== FASHN_SPACE ? [own, fashn] : [fashn];
}

export const SPACES = spaceList(import.meta.env.VITE_TRYON_SPACE);
export const SPACE_URL = SPACES[0].url;
export const SPACE_PAGE = SPACES[0].page;

/** About how long one try-on takes on the Space when nobody is ahead in the queue (measured 26 s at 30 steps). */
export const PASS_MS = 26_000;
/** Fewer denoising steps than the Space's default 50: about half the GPU time, which the free allowance counts. */
const TIMESTEPS = 30;

export type TryOnCategory = 'tops' | 'bottoms';

export type SpaceStatus = { kind: 'queued'; position: number | null; etaS: number | null } | { kind: 'running' };

/** `flat-lay`: the garment photographed on its own; `model`: worn by a model (see garment.ts). */
export type GarmentPhotoType = 'flat-lay' | 'model';

/** One try-on: `person` wearing `garment`; resolves to the result image. `signal` cancels it (the shopper's Cancel). */
export type TryOnRunner = (
  person: Blob,
  garment: Blob,
  category: TryOnCategory,
  photoType: GarmentPhotoType,
  onStatus: (s: SpaceStatus) => void,
  signal?: AbortSignal,
) => Promise<Blob>;

/**
 * A failure in words the shopper can act on. `quota`: today's free allowance is used up (stop further passes);
 * `cancelled`: the shopper stopped it.
 */
export class SpaceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly quota = false,
    readonly detail: string | null = null,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'SpaceError';
  }
}

export const cancelledError = (): SpaceError => new SpaceError('Cancelled.', true, false, null, true);

/**
 * Deadlines. A free Space can stall without closing the connection (cold start, a stuck GPU, a dropped stream); without
 * these the shopper waits forever with every button locked. No progress = no new queue position or stage: a moving
 * queue keeps resetting it (one job takes ~26 s), a first run that loads the model may take a while, hence 2 min.
 */
export const NO_PROGRESS_MS = 120_000;
export const PASS_LIMIT_MS = 10 * 60_000;
/** Per Space: a duplicate that doesn't answer in time hands over to FASHN's. */
const CONNECT_EACH_MS = 20_000;
const CONNECT_MS = CONNECT_EACH_MS * SPACES.length + 5_000;
const DOWNLOAD_MS = 30_000;

/** `promise`, unless `ms` pass first (rejects with `onTimeout()`) or `signal` aborts (rejects as cancelled). */
export function within<T>(promise: Promise<T>, ms: number, signal: AbortSignal | undefined, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const timer = setTimeout(() => settle(() => reject(onTimeout())), Math.max(0, ms));
    const abort = () => settle(() => reject(cancelledError()));
    function settle(then: () => void) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      then();
    }
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (v) => settle(() => resolve(v)),
      (e: unknown) => settle(() => reject(e)),
    );
  });
}

const tooSlow = (why: string) =>
  new SpaceError('The free try-on is taking too long (busy or stuck). Try again in a minute.', true, false, why);

/** Maps what the Space or the network said to a SpaceError. */
export function describeSpaceError(raw: string | undefined): SpaceError {
  const text = (raw ?? '').trim();
  const detail = text ? text.slice(0, 300) : null;
  if (/zerogpu|gpu quota|runs limit|exceeded your|quota/i.test(text)) {
    return new SpaceError(
      "Hugging Face's free GPU time for your connection is used up for now. It resets within a day of your first try-on; try again then.",
      true,
      true,
      detail,
    );
  }
  // gradio's own words: "This application is currently busy. Please try again.", "GPU task aborted", "No GPU was available"
  if (/queue is full|too many|currently busy|gpu task aborted|no gpu was available|try again later/i.test(text)) {
    return new SpaceError('The free try-on is busy right now. Try again in a minute.', true, false, detail);
  }
  if (/sleep|building|starting|paused|metadata|could not (be )?(loaded|resolve)|connection|fetch|network|503|502/i.test(text)) {
    return new SpaceError('The free try-on model is waking up or unreachable. Try again in a minute.', true, false, detail);
  }
  if (/upload a person|person image/i.test(text)) return new SpaceError("The try-on couldn't read your photo. Try another one.", false, false, detail);
  return new SpaceError("The try-on didn't work for this photo. Try again, or use a clearer full-body photo.", true, false, detail);
}

/** UNIQLO's image CDN sends no CORS headers; the same-site /uniqlo/ rewrite (vercel.json, vite.config.ts) proxies it. */
export function garmentUrl(url: string): string {
  return url.replace(/^https:\/\/image\.uniqlo\.com\//, '/uniqlo/');
}

type GradioClient = Awaited<ReturnType<typeof import('@gradio/client').Client.connect>>;
let client: Promise<GradioClient> | null = null;
/** The Space the open connection goes to (the privacy notes link the configured one; both are public demos). */
export let connectedSpace: SpaceRef = SPACES[0];

/** Connects to the first Space that answers (ours, then FASHN's). */
function connect(): Promise<GradioClient> {
  if (!client) {
    client = import('@gradio/client')
      .then(async ({ Client }) => {
        let lastError: unknown = null;
        for (const space of SPACES) {
          try {
            const app = await within(Client.connect(space.url, { events: ['data', 'status'] }), CONNECT_EACH_MS, undefined, () => new Error(`${space.id}: connection timed out`));
            connectedSpace = space;
            return app;
          } catch (err: unknown) {
            console.warn(`[tryon] ${space.id} unreachable`, err);
            lastError = err;
          }
        }
        throw lastError;
      })
      .catch((err: unknown) => {
        client = null; // try a fresh connection next time
        throw err;
      });
  }
  return client;
}

/** Opens the connection to the Space ahead of the first try-on (never throws; a failure is retried on use). */
export function warmUp(): Promise<void> {
  return connect().then(
    () => undefined,
    () => undefined,
  );
}

interface StatusMessage {
  type: 'status';
  stage?: string;
  message?: string | null;
  position?: number | null;
  eta?: number | null;
}

/** Runs one try-on on the Space. Throws SpaceError (cancelled, timed out, or what the Space said). */
export const runSpace: TryOnRunner = async (person, garment, category, photoType, onStatus, signal) => {
  const started = Date.now();
  let app: GradioClient;
  try {
    app = await within(connect(), CONNECT_MS, signal, () => describeSpaceError('connection timed out'));
  } catch (err: unknown) {
    if (err instanceof SpaceError) throw err;
    throw describeSpaceError(err instanceof Error ? err.message : String(err));
  }
  const job = app.submit('/try_on', {
    person_image: person,
    garment_image: garment,
    category,
    garment_photo_type: photoType,
    num_timesteps: TIMESTEPS,
    guidance_scale: 1.5,
    seed: 42,
    segmentation_free: true,
  });
  const messages = job[Symbol.asyncIterator]();
  let progressAt = Date.now();
  let lastStatus = '';
  try {
    for (;;) {
      const sinceProgress = Date.now() - progressAt;
      const sinceStart = Date.now() - started;
      const left = Math.min(NO_PROGRESS_MS - sinceProgress, PASS_LIMIT_MS - sinceStart);
      const next = await within(messages.next(), left, signal, () =>
        tooSlow(sinceStart + left >= PASS_LIMIT_MS ? 'over 10 minutes' : `no progress for ${NO_PROGRESS_MS / 1000} s`),
      );
      if (next.done) break;
      const msg = next.value;
      if (msg.type === 'status') {
        const status = msg as unknown as StatusMessage;
        if (status.stage === 'error') throw describeSpaceError(status.message ?? 'error');
        const now = `${status.stage}:${status.position ?? ''}`;
        if (now !== lastStatus) {
          lastStatus = now;
          progressAt = Date.now();
        }
        if (status.stage === 'pending') onStatus({ kind: 'queued', position: status.position ?? null, etaS: status.eta ?? null });
        else if (status.stage === 'generating') onStatus({ kind: 'running' });
      } else if (msg.type === 'data') {
        const out = (msg.data as { url?: string }[] | undefined)?.[0];
        if (!out?.url) throw describeSpaceError('no image in the result');
        const res = await within(fetch(out.url, { signal }), DOWNLOAD_MS, signal, () => tooSlow('result download timed out'));
        if (!res.ok) throw describeSpaceError(`result download failed: HTTP ${res.status}`);
        return await within(res.blob(), DOWNLOAD_MS, signal, () => tooSlow('result download timed out'));
      }
    }
  } catch (err: unknown) {
    void job.cancel?.().catch(() => undefined); // leave the shared queue rather than hold a place
    if (err instanceof SpaceError) throw err;
    throw describeSpaceError(err instanceof Error ? err.message : String(err));
  }
  throw describeSpaceError('the try-on ended without a result');
};

/** 1 -> 1st, 2 -> 2nd, 11 -> 11th, 22 -> 22nd */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * "3rd in line · about 1 min". gradio reports the job being processed as pending at position 0 (an endpoint that
 * returns one image never says "generating"), so position 0 is "Dressing you".
 */
export function describeStatus(s: SpaceStatus): string {
  if (s.kind === 'running') return 'Dressing you…';
  if (s.position === null) return 'Waiting for the free GPU…';
  if (s.position <= 0) return 'Dressing you…';
  const eta = s.etaS && s.etaS > 0 ? ` · about ${Math.max(1, Math.round(s.etaS / 60))} min` : '';
  return `${ordinal(s.position + 1)} in line${eta}`;
}
