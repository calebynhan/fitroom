import { create } from 'zustand';

export const EXPECTED_SHOT_MS = 30_000;

export type PhotoState =
  | { kind: 'idle' }
  | { kind: 'working'; key: string; auto: boolean; startedAt: number }
  | { kind: 'error'; message: string; detail: string | null; retryable: boolean };

export interface PhotoFailure {
  message: string;
  /** The service's own explanation, shown under the message. */
  detail?: string | null;
  /** Whether a retry could help (false for quota, setup and limit errors). */
  retryable?: boolean;
}

export interface PhotoCaption {
  scene: string;
  heightCm: number;
  title: { top: string | null; bottom: string | null };
  date: string;
}

export interface Shot {
  image: string;
  caption: PhotoCaption;
}

interface PhotoStore {
  photo: PhotoState;
  /** Finished photographs by look key, so revisiting a look costs nothing. */
  shots: Record<string, Shot>;
  /** Look key the visitor sent back to 3D; its photo stays hidden until they ask for it. */
  hidden: string | null;
  /** Automatic shots stop for the session after one fails (manual still works). */
  autoOff: boolean;
  remaining: number | null;
  plates: number;
  start: (key: string, auto: boolean) => void;
  succeed: (key: string, shot: Shot, remaining: number | null) => void;
  fail: (failure: PhotoFailure, remaining: number | null, auto: boolean) => void;
  hide: (key: string) => void;
  show: () => void;
  dismiss: () => void;
}

export const usePhoto = create<PhotoStore>()((set) => ({
  photo: { kind: 'idle' },
  shots: {},
  hidden: null,
  autoOff: false,
  remaining: null,
  plates: 0,
  start: (key, auto) => set({ photo: { kind: 'working', key, auto, startedAt: Date.now() } }),
  succeed: (key, shot, remaining) =>
    set((s) => ({
      photo: { kind: 'idle' },
      shots: { ...s.shots, [key]: shot },
      hidden: s.hidden === key ? null : s.hidden,
      remaining: remaining ?? s.remaining,
      plates: s.plates + 1,
    })),
  fail: ({ message, detail = null, retryable = true }, remaining, auto) =>
    set((s) => ({
      photo: auto ? { kind: 'idle' } : { kind: 'error', message, detail, retryable },
      autoOff: s.autoOff || auto,
      remaining: remaining ?? s.remaining,
    })),
  hide: (key) => set({ hidden: key }),
  show: () => set({ hidden: null }),
  dismiss: () => set({ photo: { kind: 'idle' } }),
}));
