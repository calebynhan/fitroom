import { useEffect, useState } from 'react';
import { VIEW_LABEL, VIEWS, type SizeCompare, type View } from '@api/look';
import { fitPrefs, sizingBody } from '../body/profile';
import type { Slot } from '../catalog/types';
import { fitCard } from '../fit/fitCard';
import { formatSize } from '../fit/sizing';
import type { LookInput } from '../look/request';
import { canCompare, retryView, shootCompare } from '../look/shoot';
import { useLookInput } from '../look/useLookInput';
import { doneCount, useLooks, type Look, type ViewState } from '../state/looks';
import { useApp } from '../state/store';
import { compareDownloadName, downloadName } from './download';
import { FitTable } from './FitTable';
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
          <img src={state.image} alt={`You, ${VIEW_LABEL[view].toLowerCase()} view`} width={1024} height={1536} />
        </button>
      );
      break;
    case 'working':
      body = (
        <div className="frame-status">
          <span className="frame-title">Developing…</span>
          <span className="frame-bar">
            <span style={{ transform: `scaleX(${viewProgress(state, now).toFixed(3)})` }} />
          </span>
          <span className="eyebrow muted">{view === 'front' ? 'Usually under a minute' : 'Matching the front shot'}</span>
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
          <span className="eyebrow muted">{frontDone || view === 'front' ? 'Up next' : 'After the front shot'}</span>
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

/** The comparison photo's frame: a button to shoot it, its progress, the photo, or why it failed. */
function CompareFrame({ look, slot, size, state }: { look: Look; slot: Slot; size: string; state: ViewState | undefined }) {
  const busy = useLooks((s) => s.busy !== null);
  const now = useNow(state?.kind === 'working');
  const shoot = () => void shootCompare(look.key, slot);
  let body;
  switch (state?.kind) {
    case 'done':
      body = <img src={state.image} alt={`You, front view, in size ${formatSize(size)}`} width={1024} height={1536} />;
      break;
    case 'working':
      body = (
        <div className="frame-status">
          <span className="frame-title">Developing…</span>
          <span className="frame-bar">
            <span style={{ transform: `scaleX(${viewProgress(state, now).toFixed(3)})` }} />
          </span>
          <span className="eyebrow muted">Same shot, size {formatSize(size)}</span>
        </div>
      );
      break;
    case 'error':
      body = (
        <div className="frame-status frame-fail" role="alert">
          <span>{state.message}</span>
          {state.detail && <span className="error-detail">{state.detail}</span>}
          {state.retryable && (
            <button type="button" className="link-btn" disabled={busy} onClick={shoot}>
              Retry
            </button>
          )}
        </div>
      );
      break;
    default:
      body = (
        <div className="frame-status">
          <button type="button" className="btn btn-dark" disabled={busy} onClick={shoot}>
            See It in {formatSize(size)}
          </button>
          <span className="eyebrow muted">{busy ? 'After the photos above' : 'Free · about 30 s'}</span>
        </div>
      );
  }
  return (
    <figure className={`frame frame-${state?.kind ?? 'waiting'}`}>
      <div className="frame-media">{body}</div>
      <figcaption>
        <span className="eyebrow">Size {formatSize(size)}</span>
        {state?.kind === 'done' && (
          <a className="frame-dl" href={state.image} download={compareDownloadName(size)}>
            Download
          </a>
        )}
      </figcaption>
    </figure>
  );
}

function CompareBlock({ look, slot, compare, shotSize }: { look: Look; slot: Slot; compare: SizeCompare; shotSize: string }) {
  const catalog = useApp((s) => s.catalog);
  const outfit = useApp((s) => s.outfit);
  const profile = useApp((s) => s.profile);
  const item = catalog.find((i) => i.id === outfit[slot]?.itemId);
  const body = sizingBody(profile);
  const shot = look.compares?.[slot];
  // A photo already made (or developing) keeps its size even if the suggestion moved since (e.g. a new preference).
  const size = shot && shot.state.kind !== 'error' ? shot.size : compare.size;
  const front = look.views.front;
  if (!item || !body || front.kind !== 'done') return null;
  const card = fitCard(item, [shotSize, size], body, profile.units, fitPrefs(profile)[slot]);
  return (
    <div className="compare-block">
      <h3 className="compare-title">
        <span translate="no">{item.name}</span>: {formatSize(shotSize)} <em>or</em> {formatSize(size)}?
      </h3>
      <div className="compare-body">
        <div className="compare-pair">
          <figure className="frame frame-done">
            <div className="frame-media">
              <img src={front.image} alt={`You, front view, in size ${formatSize(shotSize)}`} width={1024} height={1536} />
            </div>
            <figcaption>
              <span className="eyebrow">Size {formatSize(shotSize)} · shot</span>
            </figcaption>
          </figure>
          <CompareFrame look={look} slot={slot} size={size} state={shot?.size === size ? shot.state : undefined} />
        </div>
        {card && <FitTable card={card} caption={`${item.name}: ${card.sizes.join(' and ')} on you`} firstTag="shot" className="compare-card" />}
      </div>
    </div>
  );
}

/** Two sizes side by side: the finished front shot, the same shot in the other size, and the fit card. */
function ComparePanel({ look }: { look: Look }) {
  const input = useLookInput();
  if (!input.ready || input.key !== look.key || look.views.front.kind !== 'done' || !canCompare(look.key)) return null;
  const slots = (['top', 'bottom'] as const).filter((slot) => input.compares[slot]);
  if (slots.length === 0) return null;
  return (
    <section className="compare" aria-labelledby="compare-title">
      <div className="compare-head">
        <h2 className="eyebrow" id="compare-title">
          Compare sizes
        </h2>
        <p className="note">Between two sizes? See the same front shot in the other one, with the numbers. It doesn't use a look.</p>
      </div>
      {slots.map((slot) => {
        const shotSize = input.base.items.find((p) => p.slot === slot)?.size;
        return shotSize ? <CompareBlock key={slot} look={look} slot={slot} compare={input.compares[slot]!} shotSize={shotSize} /> : null;
      })}
    </section>
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
  const remaining = useLooks((s) => s.remaining);
  const busy = useLooks((s) => s.busy === look.key);
  const [open, setOpen] = useState<View | null>(null);
  const { caption } = look;
  const done = doneCount(look);
  const openDone = open !== null && look.views[open].kind === 'done';
  useEffect(() => {
    if (open !== null && !openDone) setOpen(null); // its photo went away (e.g. a reshoot started)
  }, [open, openDone]);
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
        {look.notice && (
          <p className="stale-note" role="status">
            {look.notice}
          </p>
        )}
        {stale && <p className="stale-note">You changed something since these were shot. Make new shots to see it.</p>}
      </div>
      <div className="frames">
        {VIEWS.map((view) => (
          <Frame key={view} look={look} view={view} onOpen={() => setOpen(view)} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {busy ? `${done} of 4 photos ready.` : done === 4 ? 'All 4 photos are ready.' : ''}
      </p>
      <div className="lookbook-foot">
        {done > 1 && (
          <button type="button" className="btn btn-outline" onClick={() => downloadAll(look)}>
            Download All
          </button>
        )}
        <div className="foot-notes">
          <p className="note">
            AI-generated from your photos and measurements. Fit and length follow the size chart; check the product page before
            you buy. Photos are not saved: download the ones you want to keep.
          </p>
          {done > 0 && remaining !== null && remaining > 0 && (
            <p className="note">
              Shooting again uses one of your {remaining} remaining {remaining === 1 ? 'look' : 'looks'}.
            </p>
          )}
        </div>
      </div>
      {!stale && <ComparePanel look={look} />}
      {open && openDone && <Lightbox look={look} view={open} onClose={() => setOpen(null)} onNavigate={setOpen} />}
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
        <div className="eyebrow muted">Your fitting room</div>
        <h1 className="lookbook-title">
          See it on <em>you</em>.
        </h1>
        <p className="intro-copy">
          Three photos and your measurements become four shots of you in the outfit, from the front, three-quarter, side and
          back, like the model on a product page, in the size that fits you.
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
          <p className="intro-ready">Ready. Press Make My Shots.</p>
        ) : (
          <a className="btn btn-dark intro-start" href="#you">
            Add Your Photos
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
