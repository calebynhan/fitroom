import { create } from 'zustand';
import { VIEWS, type View } from '@api/look';
import type { Slot } from '../catalog/types';
import type { LookCaption } from '../look/request';

/** About how long one photo takes; drives the estimated progress bars. */
export const EXPECTED_SHOT_MS = 35_000;

export type ViewState =
  | { kind: 'waiting' }
  | { kind: 'working'; startedAt: number }
  | { kind: 'done'; image: string }
  | { kind: 'error'; message: string; detail: string | null; retryable: boolean };

/** The front shot again with one item in another size (costs no look). */
export interface CompareShot {
  size: string;
  state: ViewState;
}

export interface Look {
  key: string;
  caption: LookCaption;
  views: Record<View, ViewState>;
  /** Size comparisons of this look, per slot. */
  compares?: Partial<Record<Slot, CompareShot>>;
  /** Shown above the photos, e.g. why a reshoot was abandoned. */
  notice?: string;
}

interface LooksStore {
  /** Looks by key, so going back to an earlier outfit shows its photos again at no cost. */
  looks: Record<string, Look>;
  /** Key of the look being shot right now (one at a time). */
  busy: string | null;
  /** The most recently started look, shown (marked out of date) after the shopper changes something. */
  latest: string | null;
  /** Looks this visitor has left, as last reported by the server. */
  remaining: number | null;
  start: (key: string, caption: LookCaption) => void;
  setView: (key: string, view: View, state: ViewState) => void;
  setCompare: (key: string, slot: Slot, shot: CompareShot) => void;
  setBusy: (key: string | null) => void;
  setRemaining: (remaining: number | null) => void;
  /** Puts an earlier look back (a reshoot whose front shot failed must not cost the photos already made). */
  restore: (look: Look, notice: string) => void;
}

const allWaiting = (): Record<View, ViewState> =>
  Object.fromEntries(VIEWS.map((v) => [v, { kind: 'waiting' }])) as Record<View, ViewState>;

export const useLooks = create<LooksStore>()((set) => ({
  looks: {},
  busy: null,
  latest: null,
  remaining: null,
  start: (key, caption) => set((s) => ({ latest: key, looks: { ...s.looks, [key]: { key, caption, views: allWaiting() } } })),
  setView: (key, view, state) =>
    set((s) => {
      const look = s.looks[key];
      return look ? { looks: { ...s.looks, [key]: { ...look, views: { ...look.views, [view]: state } } } } : {};
    }),
  setCompare: (key, slot, shot) =>
    set((s) => {
      const look = s.looks[key];
      return look ? { looks: { ...s.looks, [key]: { ...look, compares: { ...look.compares, [slot]: shot } } } } : {};
    }),
  setBusy: (busy) => set({ busy }),
  setRemaining: (remaining) => set((s) => ({ remaining: remaining ?? s.remaining })),
  restore: (look, notice) => set((s) => ({ looks: { ...s.looks, [look.key]: { ...look, notice } } })),
}));

/** True while there are photos only this tab holds (reload or close loses them), or a shoot is running. */
export function hasUnsavedPhotos(s: Pick<LooksStore, 'looks' | 'busy'>): boolean {
  return s.busy !== null || Object.values(s.looks).some((l) => doneCount(l) > 0);
}

export function doneCount(look: Look | undefined): number {
  return look ? VIEWS.filter((v) => look.views[v].kind === 'done').length : 0;
}
