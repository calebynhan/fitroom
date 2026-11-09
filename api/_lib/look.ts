// Contract for POST /api/photoreal: one photograph (one view) of a personalised look.
// Pure and dependency-free: the web app imports these types and constants through the @api alias.

export const VIEWS = ['front', 'three_quarter', 'side', 'back'] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = {
  front: 'Front',
  three_quarter: 'Three-quarter',
  side: 'Side',
  back: 'Back',
};

export const SCENES = ['studio', 'city', 'night'] as const;
export type Scene = (typeof SCENES)[number];

/** Room in the garment around the body (tops: chest, bottoms: hips), from the size chart. */
export type Ease = 'close' | 'regular' | 'relaxed' | 'oversized';
/** Where the hem lands. Tops: cropped | regular | long. Bottoms: cropped | ankle | full | long. */
export type Length = 'cropped' | 'regular' | 'long' | 'ankle' | 'full';

export interface BodySpec {
  heightCm: number;
  weightKg: number;
  chestCm: number;
  waistCm: number;
  hipsCm: number;
  inseamCm: number;
}

export interface LookPiece {
  slot: 'top' | 'bottom';
  name: string;
  color: string;
  fabric: string;
  size?: string;
  ease?: Ease;
  length?: Length;
  /** UNIQLO product photo in the chosen colour (https://image.uniqlo.com/... only). */
  image?: string;
}

export interface LookPhotos {
  /** Full body, facing the camera. */
  front: string;
  /** Full body, turned 90 degrees. */
  side: string;
  /** Close-up of the face in left profile. */
  face: string;
}

export interface LookRequest {
  view: View;
  scene: Scene;
  body: BodySpec;
  items: LookPiece[];
  photos: LookPhotos;
  /** The finished front shot of this look; required for every other view so all four match. */
  reference?: string;
  /** Returned by the front shot; the other three views of the same look need it and cost no extra look. */
  lookToken?: string;
}

export interface LookSuccess {
  image: string;
  view: View;
  /** Only on the front shot. */
  lookToken?: string;
  /** Looks this visitor has left. */
  remaining: number;
}

export interface LookFailure {
  error: string;
  detail?: string;
  retryable: boolean;
  remaining?: number;
}

export const PHOTO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
/** Per image: ~1.1 MB decoded. Four images stay well under Vercel's 4.5 MB request cap. */
export const MAX_PHOTO_CHARS = 1_500_000;
export const PRODUCT_IMAGE_RE = /^https:\/\/image\.uniqlo\.com\/[A-Za-z0-9/_\-.]+\.(jpg|jpeg|png|webp)$/i;

const BODY_RANGES: Record<keyof BodySpec, [number, number]> = {
  heightCm: [120, 230],
  weightKg: [30, 250],
  chestCm: [55, 170],
  waistCm: [45, 170],
  hipsCm: [55, 170],
  inseamCm: [50, 110],
};
const EASES: Ease[] = ['close', 'regular', 'relaxed', 'oversized'];
const LENGTHS: Length[] = ['cropped', 'regular', 'long', 'ankle', 'full'];
const MAX_FIELD = 60;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Letters, digits and plain punctuation only: these strings go into the image prompt. */
export function cleanText(v: unknown, max = MAX_FIELD): string {
  return typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .,'&\-/|]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function isView(v: unknown): v is View {
  return typeof v === 'string' && (VIEWS as readonly string[]).includes(v);
}

export function isScene(v: unknown): v is Scene {
  return typeof v === 'string' && (SCENES as readonly string[]).includes(v);
}

function isPhoto(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && PHOTO_DATA_URL_RE.test(v);
}

export function parseBody(v: unknown): Parsed<BodySpec> {
  if (!v || typeof v !== 'object') return fail('Enter your height and weight.');
  const raw = v as Record<string, unknown>;
  const out = {} as BodySpec;
  for (const [key, [min, max]] of Object.entries(BODY_RANGES) as [keyof BodySpec, [number, number]][]) {
    const n = raw[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return fail(`Body measurement ${key} is missing or out of range.`);
    out[key] = Math.round(n * 10) / 10;
  }
  return { ok: true, value: out };
}

export function parsePieces(v: unknown): LookPiece[] {
  if (!Array.isArray(v)) return [];
  const pieces: LookPiece[] = [];
  for (const p of v.slice(0, 2)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const slot = r.slot === 'top' || r.slot === 'bottom' ? r.slot : null;
    const name = cleanText(r.name);
    const color = cleanText(r.color);
    if (!slot || !name || !color || pieces.some((x) => x.slot === slot)) continue;
    const fabric = cleanText(typeof r.fabric === 'string' ? r.fabric.replace(/_/g, ' ') : '');
    const piece: LookPiece = { slot, name, color, fabric };
    const size = cleanText(r.size, 12);
    if (size) piece.size = size;
    if (EASES.includes(r.ease as Ease)) piece.ease = r.ease as Ease;
    if (LENGTHS.includes(r.length as Length)) piece.length = r.length as Length;
    if (typeof r.image === 'string' && PRODUCT_IMAGE_RE.test(r.image)) piece.image = r.image;
    pieces.push(piece);
  }
  return pieces.sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'top' ? -1 : 1));
}

/** Validates a POST /api/photoreal body. Error messages are shown to the shopper as-is. */
export function parseLookRequest(body: Record<string, unknown> | null): Parsed<LookRequest> {
  if (!body) return fail('Expected a JSON body.');
  const view = body.view ?? 'front';
  if (!isView(view)) return fail('Unknown view.');
  const photos = body.photos as Record<string, unknown> | undefined;
  if (!photos || !isPhoto(photos.front) || !isPhoto(photos.side) || !isPhoto(photos.face)) {
    return fail('Add all three photos (front, side and face profile) as JPEG or PNG under 1 MB each.');
  }
  const bodySpec = parseBody(body.body);
  if (!bodySpec.ok) return bodySpec;
  const items = parsePieces(body.items);
  if (items.length === 0) return fail('Pick at least one item to wear.');
  const request: LookRequest = {
    view,
    scene: isScene(body.scene) ? body.scene : 'studio',
    body: bodySpec.value,
    items,
    photos: { front: photos.front, side: photos.side, face: photos.face },
  };
  if (view !== 'front') {
    if (!isPhoto(body.reference)) return fail('The other angles need the finished front shot. Make the front shot first.');
    if (typeof body.lookToken !== 'string' || body.lookToken.length > 200) return fail('This angle needs the front shot of the same look first.');
    request.reference = body.reference;
    request.lookToken = body.lookToken;
  }
  return { ok: true, value: request };
}
