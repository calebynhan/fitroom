// Shoots a look: the front first, then three-quarter, side and back at once, each given the finished front shot so
// all four show the same person, outfit, shoes and light. Each view is its own request and can be retried alone.
import { VIEWS, type LookFailure, type LookSuccess, type View } from '@api/look';
import type { Slot } from '../catalog/types';
import { downscaleDataUrl } from '../photos/prepare';
import { doneCount, useLooks, type ViewState } from '../state/looks';
import { useApp } from '../state/store';
import { lookInput, type LookBase } from './request';

const OTHER_VIEWS = VIEWS.filter((v) => v !== 'front');
const REFERENCE_MAX_SIDE = 1024;
const REFERENCE_MAX_CHARS = 900_000; // with the three photos' budgets, stays under MAX_BODY_CHARS
const MAX_BODY_CHARS = 4_000_000; // Vercel rejects request bodies over 4.5 MB

interface Session {
  base: LookBase;
  token?: string;
  reference?: string;
}
const sessions = new Map<string, Session>();

type Answer = LookSuccess | (LookFailure & { status?: number });

export async function postView(body: object, fetcher: typeof fetch = fetch): Promise<Answer> {
  const payload = JSON.stringify(body);
  if (payload.length > MAX_BODY_CHARS) return { error: 'Your photos are too large to send. Try smaller ones.', retryable: false };
  try {
    const res = await fetcher('/api/photoreal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    if (res.status === 413) return { error: 'Your photos are too large to send. Try smaller ones.', detail: 'HTTP 413', retryable: false };
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      return { error: 'The server could not finish this photo. Try again in a moment.', detail: `HTTP ${res.status}`, retryable: true };
    }
    return (await res.json()) as Answer;
  } catch (err: unknown) {
    console.error('[look] request failed', err);
    return { error: 'Could not reach the server. Check your connection and try again.', retryable: true };
  }
}

/** The photo, or the failure as the shopper sees it. */
function outcome(answer: Answer): ViewState {
  if ('image' in answer && answer.image) return { kind: 'done', image: answer.image };
  const failure = answer as LookFailure;
  return {
    kind: 'error',
    message: failure.error ?? 'Something went wrong.',
    detail: failure.detail ?? null,
    retryable: failure.retryable ?? true,
  };
}

function report(key: string, view: View, answer: Answer): answer is LookSuccess {
  const looks = useLooks.getState();
  looks.setRemaining(typeof answer.remaining === 'number' ? answer.remaining : null);
  const state = outcome(answer);
  looks.setView(key, view, state);
  return state.kind === 'done';
}

async function shootFront(key: string, session: Session): Promise<boolean> {
  useLooks.getState().setView(key, 'front', { kind: 'working', startedAt: Date.now() });
  const answer = await postView({ ...session.base, view: 'front' });
  // The token first: the finished front shot shows the size comparison, which needs it.
  if ('image' in answer && answer.image) session.token = answer.lookToken;
  if (!report(key, 'front', answer)) return false;
  try {
    session.reference = await downscaleDataUrl(answer.image, REFERENCE_MAX_SIDE, REFERENCE_MAX_CHARS);
  } catch {
    session.reference = answer.image;
  }
  return true;
}

async function shootAngle(key: string, session: Session, view: View): Promise<void> {
  if (!session.reference || !session.token) return;
  useLooks.getState().setView(key, view, { kind: 'working', startedAt: Date.now() });
  const answer = await postView({ ...session.base, view, reference: session.reference, lookToken: session.token });
  report(key, view, answer);
}

async function shootRemaining(key: string, session: Session): Promise<void> {
  const look = useLooks.getState().looks[key];
  const todo = OTHER_VIEWS.filter((v) => look?.views[v].kind !== 'done');
  await Promise.all(todo.map((v) => shootAngle(key, session, v)));
}

async function exclusive(key: string, run: () => Promise<void>): Promise<void> {
  if (useLooks.getState().busy) return;
  useLooks.getState().setBusy(key);
  try {
    await run();
  } finally {
    useLooks.getState().setBusy(null);
  }
}

/** Shoots all four photos of the look on screen (starting over if it was shot before). */
export function makeLook(): Promise<void> {
  const input = lookInput(useApp.getState());
  if (!input.ready) return Promise.resolve();
  const { key, base, caption } = input;
  return exclusive(key, async () => {
    const previous = useLooks.getState().looks[key];
    const previousSession = sessions.get(key);
    const session: Session = { base };
    sessions.set(key, session);
    useLooks.getState().start(key, caption);
    if (await shootFront(key, session)) {
      await shootRemaining(key, session);
      return;
    }
    // A reshoot whose front failed: put the earlier photos back rather than leave a failed, empty look.
    if (previous && doneCount(previous) > 0) {
      const failed = useLooks.getState().looks[key]?.views.front;
      const reason = failed?.kind === 'error' ? failed.message : 'The new shot failed.';
      useLooks.getState().restore(previous, `Couldn't shoot this look again: ${reason} Your earlier photos are kept.`);
      if (previousSession) sessions.set(key, previousSession);
    }
  });
}

/** True when the look on screen has a finished front shot and a token to compare a size with. */
export function canCompare(key: string): boolean {
  const session = sessions.get(key);
  return Boolean(session?.token && session.reference);
}

/**
 * The front shot again with the item in `slot` in its comparison size. Costs no look; the server allows two per look.
 * Only for the look on screen, so the comparison size matches what the shopper is looking at.
 */
export function shootCompare(key: string, slot: Slot): Promise<void> {
  const session = sessions.get(key);
  const input = lookInput(useApp.getState());
  if (!session?.token || !session.reference || !input.ready || input.key !== key) return Promise.resolve();
  const compare = input.compares[slot];
  if (!compare) return Promise.resolve();
  const { token, reference } = session;
  return exclusive(key, async () => {
    const looks = useLooks.getState();
    looks.setCompare(key, slot, { size: compare.size, state: { kind: 'working', startedAt: Date.now() } });
    const answer = await postView({ ...session.base, view: 'front', reference, lookToken: token, compare });
    useLooks.getState().setRemaining(typeof answer.remaining === 'number' ? answer.remaining : null);
    useLooks.getState().setCompare(key, slot, { size: compare.size, state: outcome(answer) });
  });
}

/** Tries one failed view again. A failed front shot is retried first, then the angles that still need it. */
export function retryView(key: string, view: View): Promise<void> {
  const session = sessions.get(key);
  if (!session) return makeLook();
  return exclusive(key, async () => {
    if (view === 'front' || !session.token) {
      if (await shootFront(key, session)) await shootRemaining(key, session);
    } else {
      await shootAngle(key, session, view);
    }
  });
}
