// Contract for POST /api/photoreal: one photograph (one view) of a personalised look.
// Pure and dependency-free: the web app imports these types and constants through the @api alias.
import type { AccountView, BillingCode } from './accountTypes';

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

/** Garment differences (cm) of the compared size against the size in the finished front shot. */
export interface SizeDelta {
  chestCm?: number;
  lengthCm?: number;
  hipsCm?: number;
  inseamCm?: number;
}
export const DELTA_KEYS = ['chestCm', 'lengthCm', 'hipsCm', 'inseamCm'] as const;

/**
 * A size comparison: the finished front shot again, with one item in another size. Only the size of one slot can
 * change (the token is checked against the outfit as it was shot), so it costs one photo, not a look.
 */
export interface SizeCompare {
  slot: 'top' | 'bottom';
  size: string;
  ease?: Ease;
  length?: Length;
  delta?: SizeDelta;
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
  /** Front view only, with `lookToken` and `reference`: the same shot with one item in another size. */
  compare?: SizeCompare;
}

export interface LookSuccess {
  image: string;
  view: View;
  /** Echoed on a size comparison. */
  compare?: { slot: 'top' | 'bottom'; size: string };
  /** Only on the front shot. */
  lookToken?: string;
  /** Looks this visitor has left (the cookie limit; ignore it when `account` says paid try-ons are on). */
  remaining: number;
  /** Paid try-ons on: the person's looks after this one. */
  account?: AccountView;
}

export interface LookFailure {
  error: string;
  detail?: string;
  retryable: boolean;
  remaining?: number;
  /** Paid try-ons: sign in first, or out of looks. */
  code?: BillingCode;
  account?: AccountView;
}

export const PHOTO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
/** Per image ceiling (~1.1 MB decoded). The browser aims far lower (photos/prepare.ts budgets). */
export const MAX_PHOTO_CHARS = 1_500_000;
/** All images of one request together; Vercel rejects request bodies over 4.5 MB. */
export const MAX_TOTAL_PHOTO_CHARS = 4_000_000;
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
const MAX_SIZE_FIELD = 12;
const MAX_DELTA_CM = 40;

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
    const size = cleanText(r.size, MAX_SIZE_FIELD);
    if (size) piece.size = size;
    if (EASES.includes(r.ease as Ease)) piece.ease = r.ease as Ease;
    if (LENGTHS.includes(r.length as Length)) piece.length = r.length as Length;
    if (typeof r.image === 'string' && PRODUCT_IMAGE_RE.test(r.image)) piece.image = r.image;
    pieces.push(piece);
  }
  return pieces.sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'top' ? -1 : 1));
}

/** The outfit as a size comparison shows it: the compared slot in its new size, ease and length. */
export function comparedItems(items: LookPiece[], compare: SizeCompare | undefined): LookPiece[] {
  if (!compare) return items;
  return items.map((p) => {
    if (p.slot !== compare.slot) return p;
    const piece: LookPiece = { slot: p.slot, name: p.name, color: p.color, fabric: p.fabric, size: compare.size };
    if (compare.ease) piece.ease = compare.ease;
    if (compare.length) piece.length = compare.length;
    if (p.image) piece.image = p.image;
    return piece;
  });
}

/** The `compare` field against the outfit it changes: one slot that is worn, in a size other than the one shot. */
export function parseCompare(v: unknown, items: LookPiece[]): Parsed<SizeCompare> {
  if (!v || typeof v !== 'object') return fail('Unknown size comparison.');
  const r = v as Record<string, unknown>;
  const piece = items.find((p) => p.slot === r.slot);
  const size = cleanText(r.size, MAX_SIZE_FIELD);
  if (!piece || !size) return fail('Pick an item in the outfit and a size to compare.');
  if (!piece.size) return fail('This item has no size to compare against.');
  if (size === piece.size) return fail(`The photo already shows size ${size}. Pick another size to compare.`);
  const compare: SizeCompare = { slot: piece.slot, size };
  if (EASES.includes(r.ease as Ease)) compare.ease = r.ease as Ease;
  if (LENGTHS.includes(r.length as Length)) compare.length = r.length as Length;
  const raw = r.delta && typeof r.delta === 'object' ? (r.delta as Record<string, unknown>) : {};
  const delta: SizeDelta = {};
  for (const k of DELTA_KEYS) {
    const n = raw[k];
    if (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_DELTA_CM) delta[k] = Math.round(n * 10) / 10;
  }
  if (Object.keys(delta).length) compare.delta = delta;
  return { ok: true, value: compare };
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
  const total = request.photos.front.length + request.photos.side.length + request.photos.face.length + (typeof body.reference === 'string' ? body.reference.length : 0);
  if (total > MAX_TOTAL_PHOTO_CHARS) return fail('Your photos are too large to send together. Use smaller photos.');
  const comparing = body.compare !== undefined && body.compare !== null;
  if (comparing && view !== 'front') return fail('Sizes are compared on the front view only.');
  if (view !== 'front' || comparing) {
    if (!isPhoto(body.reference)) return fail('The other angles need the finished front shot. Make the front shot first.');
    if (typeof body.lookToken !== 'string' || body.lookToken.length > 200) return fail('This angle needs the front shot of the same look first.');
    request.reference = body.reference;
    request.lookToken = body.lookToken;
  }
  if (comparing) {
    const compare = parseCompare(body.compare, items);
    if (!compare.ok) return compare;
    request.compare = compare.value;
  }
  return { ok: true, value: request };
}
