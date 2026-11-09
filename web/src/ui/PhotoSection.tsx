import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import { PHOTO_GUIDE, PHOTO_SLOTS, PhotoError, preparePhoto, type PhotoSlot } from '../photos/prepare';
import { useApp } from '../state/store';

/** Line drawings of the three poses we ask for. */
const GUIDE_ART: Record<PhotoSlot, ReactElement> = {
  front: (
    <svg viewBox="0 0 40 80" aria-hidden>
      <circle cx="20" cy="9" r="6" />
      <path d="M12 19h16l3 26M12 19l-3 26M14 19v22h12V19M15 41l-1 34M25 41l1 34M20 41v14" />
    </svg>
  ),
  side: (
    <svg viewBox="0 0 40 80" aria-hidden>
      <circle cx="20" cy="9" r="6" />
      <path d="M17 19h7l2 22-1 34M17 19l-2 22 3 34M20 22l1 22" />
    </svg>
  ),
  face: (
    <svg viewBox="0 0 40 80" aria-hidden>
      <path d="M26 22c-6-6-16-2-16 8 0 6 2 9 2 13 0 3-1 5-1 8h12c0-3 1-4 3-5l2-6 3-1-2-4 1-3c-1-4-2-7-4-10z" />
    </svg>
  ),
};

function PhotoTile({ slot }: { slot: PhotoSlot }) {
  const photo = useApp((s) => s.photos[slot]);
  const setPhoto = useApp((s) => s.setPhoto);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const guide = PHOTO_GUIDE[slot];

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      setPhoto(slot, await preparePhoto(file, slot));
    } catch (err: unknown) {
      if (err instanceof PhotoError) setError(err.message);
      else {
        console.error('[photos] could not prepare', slot, err);
        setError("Couldn't open that photo. Try a JPEG or PNG.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void accept(e.dataTransfer.files[0]);
  };

  return (
    <div className="photo-tile">
      <button
        type="button"
        className={`photo-drop ${photo ? 'filled' : ''} ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-label={`${photo ? 'Replace' : 'Add'} ${guide.label.toLowerCase()} photo: ${guide.hint}`}
        disabled={loading}
      >
        {photo ? <img src={photo.dataUrl} alt="" /> : GUIDE_ART[slot]}
        {!photo && <span className="photo-plus">{loading ? 'Reading…' : '+ Add'}</span>}
      </button>
      <div className="photo-label">
        <span>{guide.label}</span>
        {photo && (
          <button type="button" className="link-btn" onClick={() => setPhoto(slot, null)}>
            Remove
          </button>
        )}
      </div>
      <div className="photo-hint">{guide.hint}</div>
      {error && (
        <p className="msg error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = ''; // picking the same file again still fires
        }}
      />
    </div>
  );
}

export function PhotoSection() {
  return (
    <section className="rail-section" id="you" aria-labelledby="you-title">
      <h2 className="eyebrow" id="you-title">
        Your photos
      </h2>
      <div className="photo-tiles">
        {PHOTO_SLOTS.map((slot) => (
          <PhotoTile key={slot} slot={slot} />
        ))}
      </div>
      <p className="note">
        Plain wall, good light, fitted clothes. Whole body in frame for front and side; arms a little away from your sides.
      </p>
      <p className="note fine">
        Only photos of yourself. They stay in this tab and go to our image model (OpenAI) only to make your shots; FitRoom
        never stores them.
      </p>
    </section>
  );
}
