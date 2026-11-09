import { useEffect, useRef } from 'react';
import { usePhoto } from '../state/photo';
import { useFit } from '../state/store';
import { POSE_IDS, POSE_LABEL } from '../viewer/poses';
import { SCENES } from '../viewer/scenes';
import { onAngle, resetView, turnBy } from '../viewer/viewerBus';
import { makeItReal } from './usePhotoreal';
import { useProgress } from './useProgress';
import { WordTabs } from './WordTabs';

const TURN_STEP = 45;

function facing(deg: number): string {
  const d = deg > 180 ? 360 - deg : deg;
  if (d <= 45) return 'FRONT';
  if (d < 135) return 'SIDE';
  return 'BACK';
}

/** Live "FRONT · 12°" label, written straight to the DOM to avoid re-rendering every frame. */
function AngleLabel() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      onAngle((deg) => {
        if (ref.current) ref.current.textContent = `${facing(deg)} · ${deg}°`;
      }),
    [],
  );
  return <span ref={ref}>FRONT · 0°</span>;
}

const Icon = {
  left: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
      <path d="M4.5 2v3h3" />
    </svg>
  ),
  right: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2" />
      <path d="M11.5 2v3h-3" />
    </svg>
  ),
  reset: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="8" cy="8" r="3.5" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
    </svg>
  ),
  pause: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="3" width="2.2" height="10" />
      <rect x="9.8" y="3" width="2.2" height="10" />
    </svg>
  ),
  play: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3l8 5-8 5z" />
    </svg>
  ),
};

function ViewControls() {
  const autoRotate = useFit((s) => s.autoRotate);
  const setAutoRotate = useFit((s) => s.setAutoRotate);
  return (
    <div className="view-controls">
      <button type="button" title="Rotate left" aria-label="Rotate left" onClick={() => turnBy(-TURN_STEP)}>
        {Icon.left}
      </button>
      <button type="button" title="Rotate right" aria-label="Rotate right" onClick={() => turnBy(TURN_STEP)}>
        {Icon.right}
      </button>
      <button type="button" title="Reset view" aria-label="Reset view" onClick={resetView}>
        {Icon.reset}
      </button>
      <button
        type="button"
        title={autoRotate ? 'Pause' : 'Spin'}
        aria-label={autoRotate ? 'Pause rotation' : 'Start rotation'}
        onClick={() => setAutoRotate(!autoRotate)}
      >
        {autoRotate ? Icon.pause : Icon.play}
      </button>
    </div>
  );
}

function PosePicker() {
  const pose = useFit((s) => s.pose);
  const setPose = useFit((s) => s.setPose);
  return (
    <WordTabs
      className="pose-picker"
      label="Pose"
      options={POSE_IDS.map((id) => ({ id, label: POSE_LABEL[id] }))}
      value={pose}
      onChange={setPose}
    />
  );
}

function Generating() {
  const progress = useProgress();
  const scene = useFit((s) => s.scene);
  if (progress === null) return null;
  return (
    <div className="generating">
      <div className="generating-title">Composing your photograph</div>
      <div className="eyebrow muted">
        {Math.round(progress * 100)}% · {SCENES[scene].label.toUpperCase()} · ABOUT 30 SECONDS
      </div>
    </div>
  );
}

function ErrorNote() {
  const photo = usePhoto((s) => s.photo);
  const dismiss = usePhoto((s) => s.dismiss);
  const outOfShots = usePhoto((s) => s.remaining !== null && s.remaining <= 0);
  if (photo.kind !== 'error') return null;
  const canRetry = photo.retryable && !outOfShots;
  return (
    <div className="error-note" role="alert">
      <div className="error-text">
        <span>{photo.message}</span>
        {photo.detail && <span className="error-detail">{photo.detail}</span>}
      </div>
      <div className="error-actions">
        {canRetry && (
          <button type="button" className="link-btn" onClick={() => void makeItReal()}>
            Retry
          </button>
        )}
        <button type="button" className="link-btn" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function DressingNote() {
  const dressed = useFit((s) => s.dressed);
  if (dressed) return null;
  return <div className="dressing">Dressing your avatar…</div>;
}

export function ViewerChrome() {
  const scene = useFit((s) => s.scene);
  const dark = SCENES[scene].chromeDark;
  return (
    <div className={`viewer-chrome ${dark ? 'on-dark' : ''}`}>
      <div className="viewer-labels eyebrow">
        <AngleLabel />
        <span>SCENE — {SCENES[scene].label.toUpperCase()}</span>
      </div>
      <PosePicker />
      <div className="viewer-hint">Drag to rotate · scroll to zoom</div>
      <ViewControls />
      <DressingNote />
      <Generating />
      <ErrorNote />
    </div>
  );
}
