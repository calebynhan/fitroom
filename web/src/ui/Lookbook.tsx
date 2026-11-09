import { useState } from 'react';
import { VIEW_LABEL, VIEWS, type View } from '@api/look';
import type { LookInput } from '../look/request';
import { retryView } from '../look/shoot';
import { useLookInput } from '../look/useLookInput';
import { doneCount, useLooks, type Look } from '../state/looks';
import { downloadName } from './download';
import { Lightbox } from './Lightbox';
import { useNow, viewProgress } from './progress';

function Frame({ look, view, onOpen }: { look: Look; view: View; onOpen: () => void }) {
  const state = look.views[view];
  const busy = useLooks((s) => s.busy !== null);
  const now = useNow(state.kind === 'working');
  const frontDone = look.views.front.kind === 'done';

  let body;
  switch (state.kind) {
    case 'done':
      body = (
        <button type="button" className="frame-photo" onClick={onOpen} aria-label={`Open the ${VIEW_LABEL[view].toLowerCase()} photo`}>
          <img src={state.image} alt={`You, ${VIEW_LABEL[view].toLowerCase()} view`} />
        </button>
      );
      break;
    case 'working':
      body = (
        <div className="frame-status">
          <span className="frame-title">Developing</span>
          <span className="frame-bar">
            <span style={{ width: `${Math.round(viewProgress(state, now) * 100)}%` }} />
          </span>
          <span className="eyebrow muted">{view === 'front' ? 'ABOUT 30 SECONDS' : 'MATCHING THE FRONT SHOT'}</span>
        </div>
      );
      break;
    case 'error':
      body = (
        <div className="frame-status frame-fail" role="alert">
          <span>{state.message}</span>
          {state.detail && <span className="error-detail">{state.detail}</span>}
          {state.retryable && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void retryView(look.key, view)}>
              Retry
            </button>
          )}
        </div>
      );
      break;
    default:
      body = (
        <div className="frame-status">
          <span className="eyebrow muted">{frontDone || view === 'front' ? 'UP NEXT' : 'AFTER THE FRONT SHOT'}</span>
        </div>
      );
  }

  return (
    <figure className={`frame frame-${state.kind}`}>
      <div className="frame-media">{body}</div>
      <figcaption>
        <span className="eyebrow">{VIEW_LABEL[view]}</span>
        {state.kind === 'done' && (
          <a className="frame-dl" href={state.image} download={downloadName(view)}>
            Download
          </a>
        )}
      </figcaption>
    </figure>
  );
}

function downloadAll(look: Look) {
  VIEWS.forEach((view, i) => {
    const state = look.views[view];
    if (state.kind !== 'done') return;
    window.setTimeout(() => {
      const a = document.createElement('a');
      a.href = state.image;
      a.download = downloadName(view);
      a.click();
    }, i * 300); // browsers drop rapid-fire downloads
  });
}

function Shots({ look, stale }: { look: Look; stale: boolean }) {
  const [open, setOpen] = useState<View | null>(null);
  const { caption } = look;
  const done = doneCount(look);
  return (
    <div className="lookbook">
      <div className="lookbook-head">
        <div className="eyebrow muted">{caption.meta}</div>
        <h1 className="lookbook-title">
          {caption.top}
          {caption.top && caption.bottom && (
            <>
              , <em>with</em>{' '}
            </>
          )}
          {caption.bottom}
        </h1>
        {stale && <p className="stale-note">You changed something since these were shot. Make new shots to see it.</p>}
      </div>
      <div className="frames">
        {VIEWS.map((view) => (
          <Frame key={view} look={look} view={view} onOpen={() => setOpen(view)} />
        ))}
      </div>
      <div className="lookbook-foot">
        {done > 1 && (
          <button type="button" className="btn btn-outline" onClick={() => downloadAll(look)}>
            DOWNLOAD ALL
          </button>
        )}
        <p className="note">AI-generated from your photos and measurements. Fit and length follow the size chart; check the product page before you buy.</p>
      </div>
      {open && <Lightbox look={look} view={open} onClose={() => setOpen(null)} onNavigate={setOpen} />}
    </div>
  );
}

function Intro({ input }: { input: LookInput }) {
  const missing = input.ready ? [] : input.missing;
  const steps = [
    { label: 'Three photos: front, side, face profile', done: !['front photo', 'side photo', 'face profile'].some((m) => missing.includes(m)) },
    { label: 'Height and weight', done: !missing.includes('height and weight') },
    { label: 'Pick a top and bottoms', done: !missing.includes('something to wear') },
  ];
  return (
    <div className="lookbook intro">
      <div className="lookbook-head">
        <div className="eyebrow muted">YOUR FITTING ROOM</div>
        <h1 className="lookbook-title">
          See it on <em>you</em>.
        </h1>
        <p className="intro-copy">
          Three photos and your measurements. We shoot the outfit on you from four angles, like the model on a product page, in
          the size that fits you.
        </p>
        <ol className="checklist">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? 'done' : ''}>
              <span className="check" aria-hidden>
                {s.done ? '✓' : ''}
              </span>
              {s.label}
              <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
            </li>
          ))}
        </ol>
        {input.ready ? (
          <p className="intro-ready">Ready. Press Make my shots.</p>
        ) : (
          <a className="btn btn-dark intro-start" href="#you">
            ADD YOUR PHOTOS
          </a>
        )}
      </div>
      <div className="frames" aria-hidden>
        {VIEWS.map((view) => (
          <figure key={view} className="frame frame-empty">
            <div className="frame-media" />
            <figcaption>
              <span className="eyebrow">{VIEW_LABEL[view]}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** The four photographs of the look on screen; the latest look (marked out of date) once something changed. */
export function Lookbook() {
  const input = useLookInput();
  const current = useLooks((s) => (input.ready ? s.looks[input.key] : undefined));
  const latest = useLooks((s) => (s.latest ? s.looks[s.latest] : undefined));
  const look = current ?? latest;
  if (!look) return <Intro input={input} />;
  return <Shots look={look} stale={!current} />;
}
