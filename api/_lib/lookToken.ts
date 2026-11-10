// Look tokens: the front shot of a look returns one; the three other angles of that look, and up to two size
// comparisons, present it instead of spending another look. Signed, short-lived, and bound to a digest of the look
// (photos, body, outfit, setting). Which shots a token has already produced is tracked in memory (per warm instance,
// best effort, like the other counters); the IP ceiling and daily cap bound the rest.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LookRequest, SizeCompare, View } from './look';

export const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Billed attempts per angle per look (a timeout can be billed upstream without a photo). */
export const MAX_ATTEMPTS = 3;
/** Size comparisons per look (one per slot of a top + bottoms outfit). */
export const MAX_COMPARES = 2;
const MAX_TRACKED = 5000;

interface AngleUse {
  done: boolean;
  billed: number;
  /** A request for this angle is in flight (so a duplicate can't run alongside it). */
  busy: boolean;
}
const uses = new Map<string, AngleUse>();

function key(secret: string): Buffer {
  return createHash('sha256').update(`fitroom-look:${secret}`).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(payload).digest('base64url');
}

/** Fingerprint of everything a look depicts (photos, body, outfit, setting); the token only works for that look. */
export function lookDigest(req: Pick<LookRequest, 'scene' | 'body' | 'items' | 'photos'>): string {
  const { front, side, face } = req.photos;
  return createHash('sha256').update(JSON.stringify([req.scene, req.body, req.items, front, side, face])).digest('base64url').slice(0, 22);
}

export function issueLookToken(secret: string, digest: string, now: number = Date.now()): string {
  const payload = `${randomBytes(9).toString('base64url')}.${now + TOKEN_TTL_MS}`;
  return `${payload}.${sign(`${payload}.${digest}`, secret)}`;
}

/** Returns the look id if the token is genuine, unexpired and was issued for this same look. */
export function verifyLookToken(token: string | undefined, secret: string, digest: string, now: number = Date.now()): string | null {
  const parts = token?.split('.') ?? [];
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = Buffer.from(sign(`${id}.${exp}.${digest}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(exp) > now ? id : null;
}

export type AngleVerdict = { ok: true } | { ok: false; status: number; error: string; retryable: boolean };
export type AngleOutcome = 'done' | 'billed' | 'free';

/** What a request made with a token produces: one of the three angles, or a size comparison ("compare:top:M"). */
export function shotKey(view: View, compare?: Pick<SizeCompare, 'slot' | 'size'>): string {
  return compare ? `compare:${compare.slot}:${compare.size}` : view;
}

/** Size comparisons of this look that produced a photo, are developing, or may have been billed. */
function comparesUsed(lookId: string): number {
  const prefix = `${lookId}:compare:`;
  let n = 0;
  for (const [id, use] of uses) if (id.startsWith(prefix) && (use.done || use.busy || use.billed > 0)) n += 1;
  return n;
}

/** Reserves a shot of a look for one request. Settle it with settleAngle when the request ends. */
export function claimAngle(lookId: string, shot: string): AngleVerdict {
  const id = `${lookId}:${shot}`;
  const use = uses.get(id);
  const what = shot.startsWith('compare:') ? 'size comparison' : 'angle';
  if (use?.done) {
    return { ok: false, status: 409, error: `This ${what} was already made. If it didn't arrive, shoot the look again.`, retryable: false };
  }
  if (use?.busy) return { ok: false, status: 409, error: `This ${what} is already developing.`, retryable: false };
  if (use && use.billed >= MAX_ATTEMPTS) {
    return { ok: false, status: 429, error: `This ${what} failed too many times. Shoot the look again.`, retryable: false };
  }
  if (!use && shot.startsWith('compare:') && comparesUsed(lookId) >= MAX_COMPARES) {
    return { ok: false, status: 429, error: `Each look can compare ${MAX_COMPARES} sizes. Shoot a new look in the size you want.`, retryable: false };
  }
  if (!use && uses.size >= MAX_TRACKED) uses.clear();
  uses.set(id, { done: false, billed: use?.billed ?? 0, busy: true });
  return { ok: true };
}

/** Releases a claimed shot: `done` produced a photo, `billed` may have cost money without one, `free` did not. */
export function settleAngle(lookId: string, shot: string, outcome: AngleOutcome): void {
  const id = `${lookId}:${shot}`;
  const use = uses.get(id) ?? { done: false, billed: 0, busy: false };
  uses.set(id, { done: use.done || outcome === 'done', billed: use.billed + (outcome === 'free' ? 0 : 1), busy: false });
}
