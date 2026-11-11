import { useState, type PointerEvent } from 'react';

/**
 * The try-on over the shopper's own photo, with a divider: their photo to its left, the try-on to its right. Drag on
 * the image, or use the slider (keyboard). Starts at 0: the whole try-on. Hidden when the two don't line up.
 */
export function BeforeAfter({ before, after, alt }: { before: string; after: string; alt: string }) {
  const [split, setSplit] = useState(0);
  const [ratios, setRatios] = useState<{ before?: number; after?: number }>({});
  // both images often load before a re-render: merge, never overwrite
  const measure = (which: 'before' | 'after', img: HTMLImageElement) =>
    setRatios((r) => ({ ...r, [which]: img.naturalWidth / img.naturalHeight }));
  const aligned = ratios.before && ratios.after ? Math.abs(ratios.before - ratios.after) < 0.01 : null;
  const dragTo = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setSplit(Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))));
  };
  return (
    <div className="before-after">
      <div
        className="before-after-stage"
        onPointerDown={(e) => {
          if (aligned === false) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragTo(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(e);
        }}
      >
        <img src={after} alt={alt} width={1024} height={1536} onLoad={(e) => measure('after', e.currentTarget)} />
        {aligned !== false && (
          <img
            className="before-layer"
            src={before}
            alt=""
            aria-hidden
            onLoad={(e) => measure('before', e.currentTarget)}
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
        )}
        {aligned && split > 0 && split < 100 && <span className="before-after-line" style={{ left: `${split}%` }} aria-hidden />}
        {aligned && split > 0 && <span className="before-after-tag left">Your photo</span>}
        {aligned && split < 100 && <span className="before-after-tag right">Try-on</span>}
      </div>
      {aligned && (
        <label className="before-after-control">
          <span className="eyebrow">Compare with your photo</span>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            aria-valuetext={split === 0 ? 'Try-on only' : split === 100 ? 'Your photo only' : `${split}% your photo`}
          />
        </label>
      )}
    </div>
  );
}
