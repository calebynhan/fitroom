import { create } from 'zustand';

export const EXPECTED_SHOT_MS = 30_000;

export type PhotoState =
  | { kind: 'idle' }
  | { kind: 'working'; startedAt: number }
  | { kind: 'done'; image: string; caption: PhotoCaption }
  | { kind: 'error'; message: string };

export interface PhotoCaption {
  scene: string;
  heightCm: number;
  title: { top: string | null; bottom: string | null };
  date: string;
}

interface PhotoStore {
  photo: PhotoState;
  remaining: number | null;
  plates: number;
  start: () => void;
  succeed: (image: string, caption: PhotoCaption, remaining: number | null) => void;
  fail: (message: string, remaining: number | null) => void;
  dismiss: () => void;
}

export const usePhoto = create<PhotoStore>()((set) => ({
  photo: { kind: 'idle' },
  remaining: null,
  plates: 0,
  start: () => set({ photo: { kind: 'working', startedAt: Date.now() } }),
  succeed: (image, caption, remaining) =>
    set((s) => ({ photo: { kind: 'done', image, caption }, remaining, plates: s.plates + 1 })),
  fail: (message, remaining) => set((s) => ({ photo: { kind: 'error', message }, remaining: remaining ?? s.remaining })),
  dismiss: () => set({ photo: { kind: 'idle' } }),
}));
