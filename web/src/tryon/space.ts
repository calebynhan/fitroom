// The free try-on engine: FASHN VTON v1.5 (Apache-2.0) on its official Hugging Face Space, called straight from the
// shopper's browser. It repaints only the clothing in their own photo, so their face, body, pose and background stay
// theirs. Free: Hugging Face's ZeroGPU runs it, within a per-visitor daily allowance; the Space handles one try-on at
// a time for everyone, with a queue of up to 30.

/** The Space's own URL (connecting by URL skips a huggingface.co metadata lookup). */
export const SPACE_URL = 'https://fashn-ai-fashn-vton-1-5.hf.space/';
export const SPACE_PAGE = 'https://huggingface.co/spaces/fashn-ai/fashn-vton-1.5';

/** About how long one try-on takes on the Space when nobody is ahead in the queue (measured 26 s at 30 steps). */
export const PASS_MS = 26_000;
/** Fewer denoising steps than the Space's default 50: about half the GPU time, which the free allowance counts. */
const TIMESTEPS = 30;

export type TryOnCategory = 'tops' | 'bottoms';

export type SpaceStatus = { kind: 'queued'; position: number | null; etaS: number | null } | { kind: 'running' };

/** `flat-lay`: the garment photographed on its own; `model`: worn by a model (see garment.ts). */
export type GarmentPhotoType = 'flat-lay' | 'model';

/** One try-on: `person` wearing `garment`; resolves to the result image. */
export type TryOnRunner = (
  person: Blob,
  garment: Blob,
  category: TryOnCategory,
  photoType: GarmentPhotoType,
  onStatus: (s: SpaceStatus) => void,
) => Promise<Blob>;

/** A failure in words the shopper can act on. `quota`: today's free allowance is used up (stop further passes). */
export class SpaceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly quota = false,
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'SpaceError';
  }
}

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
  if (/queue is full|too many/i.test(text)) return new SpaceError('The free try-on is busy right now. Try again in a minute.', true, false, detail);
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

function connect(): Promise<GradioClient> {
  if (!client) {
    client = import('@gradio/client')
      .then(({ Client }) => Client.connect(SPACE_URL, { events: ['data', 'status'] }))
      .catch((err: unknown) => {
        client = null; // try a fresh connection next time
        throw err;
      });
  }
  return client;
}

interface StatusMessage {
  type: 'status';
  stage?: string;
  message?: string | null;
  position?: number | null;
  eta?: number | null;
}

/** Runs one try-on on the Space. Throws SpaceError. */
export const runSpace: TryOnRunner = async (person, garment, category, photoType, onStatus) => {
  let app: GradioClient;
  try {
    app = await connect();
  } catch (err: unknown) {
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
  try {
    for await (const msg of job) {
      if (msg.type === 'status') {
        const status = msg as unknown as StatusMessage;
        if (status.stage === 'error') throw describeSpaceError(status.message ?? 'error');
        if (status.stage === 'pending') onStatus({ kind: 'queued', position: status.position ?? null, etaS: status.eta ?? null });
        else if (status.stage === 'generating') onStatus({ kind: 'running' });
      } else if (msg.type === 'data') {
        const out = (msg.data as { url?: string }[] | undefined)?.[0];
        if (!out?.url) throw describeSpaceError('no image in the result');
        const res = await fetch(out.url);
        if (!res.ok) throw describeSpaceError(`result download failed: HTTP ${res.status}`);
        return await res.blob();
      }
    }
  } catch (err: unknown) {
    void job.cancel?.().catch(() => undefined); // leave the shared queue rather than hold a place
    if (err instanceof SpaceError) throw err;
    throw describeSpaceError(err instanceof Error ? err.message : String(err));
  }
  throw describeSpaceError('the try-on ended without a result');
};

/** "Third in line · about 1 min" */
export function describeStatus(s: SpaceStatus): string {
  if (s.kind === 'running') return 'Dressing you…';
  if (s.position === null || s.position <= 0) return 'Starting the free GPU…';
  const n = s.position + 1;
  const place = n === 2 ? 'Second' : n === 3 ? 'Third' : `${n}th`;
  const eta = s.etaS && s.etaS > 0 ? ` · about ${Math.max(1, Math.round(s.etaS / 60))} min` : '';
  return `${place} in line${eta}`;
}
