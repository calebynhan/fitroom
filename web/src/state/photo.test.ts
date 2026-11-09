import { beforeEach, describe, expect, it } from 'vitest';
import { usePhoto, type PhotoCaption } from './photo';

const CAPTION: PhotoCaption = { scene: 'Studio', heightCm: 178, title: { top: 'Tee in Blue', bottom: null }, date: '8 November 2026' };
const INITIAL = usePhoto.getState();

describe('photo store', () => {
  beforeEach(() => usePhoto.setState(INITIAL, true));

  it('caches a finished shot under its look key', () => {
    usePhoto.getState().start('look-a', true);
    usePhoto.getState().succeed('look-a', { image: 'data:a', caption: CAPTION }, 4);
    const s = usePhoto.getState();
    expect(s.photo.kind).toBe('idle');
    expect(s.shots['look-a']?.image).toBe('data:a');
    expect(s.remaining).toBe(4);
    expect(s.plates).toBe(1);
  });

  it('does not mutate the previous shots object', () => {
    const before = usePhoto.getState().shots;
    usePhoto.getState().succeed('look-a', { image: 'data:a', caption: CAPTION }, 4);
    expect(before).toEqual({});
  });

  it('an automatic failure turns auto off quietly (no error shown)', () => {
    usePhoto.getState().start('look-a', true);
    usePhoto.getState().fail({ message: 'upstream said no', detail: null, retryable: true }, 5, true);
    const s = usePhoto.getState();
    expect(s.photo.kind).toBe('idle');
    expect(s.autoOff).toBe(true);
  });

  it('a manual failure shows the error and leaves auto alone', () => {
    usePhoto.getState().start('look-a', false);
    usePhoto.getState().fail({ message: 'upstream said no', detail: 'Limit 0', retryable: false }, null, false);
    const s = usePhoto.getState();
    expect(s.photo).toEqual({ kind: 'error', message: 'upstream said no', detail: 'Limit 0', retryable: false });
    expect(s.autoOff).toBe(false);
    expect(s.remaining).toBeNull();
  });

  it('a failure without detail stores null detail and defaults to retryable', () => {
    usePhoto.getState().fail({ message: 'offline' }, null, false);
    expect(usePhoto.getState().photo).toEqual({ kind: 'error', message: 'offline', detail: null, retryable: true });
  });

  it('hide sends one look back to 3D; show brings it back', () => {
    usePhoto.getState().hide('look-a');
    expect(usePhoto.getState().hidden).toBe('look-a');
    usePhoto.getState().show();
    expect(usePhoto.getState().hidden).toBeNull();
  });
});
