import { useEffect, useState } from 'react';
import { VIEW_LABEL, type SizeCompare, type View } from '@api/look';
import { fitPrefs, sizingBody } from '../body/profile';
import { colorLabel, productImage, type Slot } from '../catalog/types';
import { fitCard } from '../fit/fitCard';
import { formatSize, sizeAdvice, sizePair } from '../fit/sizing';
import { cancelShots, engineViews, retryShot, TRY_ON, useShotInput, type ShotInput } from '../look/engine';
import { canCompare, shootCompare } from '../look/shoot';
import { useLookInput } from '../look/useLookInput';
import { SPACE_PAGE } from '../tryon/space';
import { useAccount } from '../account/store';
import { doneCount, useLooks, type Look, type ViewState } from '../state/looks';
import { useApp } from '../state/store';
import { compareDownloadName, downloadName } from './download';
import { FitTable } from './FitTable';
import { MeasureLink } from './measureLink';
import { Lightbox } from './Lightbox';
import { useNow, viewProgress } from './progress';
import { AddSideButton, AllowanceNote, CreditNote } from './TryOnBudget';

function Frame({ look, view, stale, onOpen }: { look: Look; view: View; stale: boolean; onOpen: () => void }) {
  const state = look.views[view];
  const busy = useLooks((s) => s.busy !== null);
  const now = useNow(state.kind === 'working');
  const frontDone = look.views.front.kind === 'done';

  let body;
  switch (state.kind) {
    case 'done':
      body = (
        <>
          <button type="button" className="frame-photo" onClick={onOpen} aria-label={`Open the ${VIEW_LABEL[view].toLowerCase()} photo`}>
            <img src={state.image} alt={`You, ${VIEW_LABEL[view].toLowerCase()} view`} width={1024} height={1536} />
          </button>
          {state.note && (
            <p className="frame-note" role="status">
              {state.note}
              {!stale && (
                <button type="button" className="link-btn" disabled={busy} onClick={() => void retryShot(look.key, view)}>
                  Retry
                </button>
              )}
            </p>
          )}
        </>
      );
      break;
    case 'working':
      body = (
        <div className="frame-status">
          <span className="frame-title">Developing…</span>
          <span className="frame-bar">
            <span style={{ transform: `scaleX(${viewProgress(state, now).toFixed(3)})` }} />
          </span>
          <span className="eyebrow muted">{state.status ?? (view === 'front' ? 'Usually under a minute' : 'Matching the front shot')}</span>
          {cancelShots && (
            <button type="button" className="link-btn" onClick={cancelShots}>
              Cancel
            </button>
          )}
        </div>
      );
      break;
    case 'error':
      body = (
        <div className="frame-status frame-fail" role="alert">
          <span>{state.message}</span>
          {state.detail && <span className="error-detail">{state.detail}</span>}
          {state.retryable && !stale && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void retryShot(look.key, view)}>
              Retry
            </button>
          )}
        </div>
      );
      break;
    default:
      body = (
        <div className="frame-status">
          <span className="eyebrow muted">{frontDone || view === 'front' || TRY_ON ? 'Up next' : 'After the front shot'}</span>
        </div>
      );
  }

  return (
    <figure className={`frame frame-${state.kind}`}>
      <div className="frame-media">{body}</div>
      <figcaption>
        <span className="eyebrow">{VIEW_LABEL[view]}</span>
        {state.kind === 'done' && (
          <a className="frame-dl" href={state.image} download={downloadName(view, state.image)}>
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

/** One item of a try-on look: UNIQLO's photo (to check the colour against), the size to buy, and how it fits in numbers. */
function TryOnSize({ slot }: { slot: Slot }) {
  const catalog = useApp((s) => s.catalog);
  const selection = useApp((s) => s.outfit[slot]);
  const profile = useApp((s) => s.profile);
  const item = selection && catalog.find((i) => i.id === selection.itemId);
  if (!item || !selection) return null;
  const body = sizingBody(profile);
  const prefs = fitPrefs(profile)[slot];
  const advice = body ? sizeAdvice(item, body, prefs) : null;
  const pair = sizePair(selection.size, advice);
  const card = body && pair ? fitCard(item, pair.compare ? [pair.size, pair.compare] : [pair.size], body, profile.units, prefs) : null;
  const image = productImage(item, selection.colorCode);
  return (
    <div className="tryon-size">
      {image && (
        <a className="tryon-size-photo" href={item.url} target="_blank" rel="noreferrer" title="Colour as UNIQLO shows it">
          <img src={image} alt={`${item.name} in ${colorLabel(item, selection.colorCode)}, on UNIQLO`} width={120} height={160} loading="lazy" />
          <span className="eyebrow muted">UNIQLO's colour</span>
        </a>
      )}
      <div className="tryon-size-body">
        <h3 className="compare-title" translate="no">
          {item.name}
        </h3>
        <p className={`size-note ${advice && !advice.fits ? 'warn' : ''}`}>
          {!pair
            ? 'Add your height and weight to get your size and see how it fits.'
            : advice && pair.size !== advice.size
              ? `Showing size ${formatSize(pair.size)} (your pick). ${advice.text}`
              : (advice?.text ?? `Size ${formatSize(pair.size)}.`)}
          {advice?.borderline && (
            <>
              {' '}
              <MeasureLink borderline={advice.borderline} />
            </>
          )}
        </p>
        {card && <FitTable card={card} caption={`${item.name}: how ${card.sizes.join(' and ')} fit you`} firstTag="yours" className="compare-card" />}
      </div>
    </div>
  );
}

/** Under try-on photos: the size story the photo can't tell (the model draws the garment as photographed, in any size). */
function TryOnSizes() {
  const outfit = useApp((s) => s.outfit);
  const slots = (['top', 'bottom'] as const).filter((slot) => outfit[slot]);
  if (slots.length === 0) return null;
  return (
    <section className="compare" aria-labelledby="tryon-size-title">
      <div className="compare-head">
        <h2 className="eyebrow" id="tryon-size-title">
          Your size
        </h2>
        <p className="note">
          The photo shows the look and colour, drawn from UNIQLO's photo; it looks the same in every size. How your size fits is
          in the numbers below. Bags and other accessories may disappear from the photo.
        </p>
      </div>
      {slots.map((slot) => (
        <TryOnSize key={slot} slot={slot} />
      ))}
    </section>
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
  look.order.forEach((view, i) => {
    const state = look.views[view];
    if (state.kind !== 'done') return;
    window.setTimeout(() => {
      const a = document.createElement('a');
      a.href = state.image;
      a.download = downloadName(view, state.image);
      a.click();
    }, i * 300); // browsers drop rapid-fire downloads
  });
}

function Shots({ look, stale }: { look: Look; stale: boolean }) {
  const cookieLooks = useLooks((s) => s.remaining);
  const paid = useAccount((s) => s.view?.billing === true);
  const remaining = paid ? null : cookieLooks; // paid try-ons count looks in the account instead
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
      <div className={`frames frames-${look.order.length}`}>
        {look.order.map((view) => (
          <Frame key={view} look={look} view={view} stale={stale} onOpen={() => setOpen(view)} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {busy ? `${done} of ${look.order.length} photos ready.` : done === look.order.length ? `All ${done} photos are ready.` : ''}
      </p>
      {TRY_ON && !stale && <AddSideButton lookKey={look.key} />}
      <div className="lookbook-foot">
        {done > 1 && (
          <button type="button" className="btn btn-outline" onClick={() => downloadAll(look)}>
            Download All
          </button>
        )}
        <div className="foot-notes">
          {TRY_ON ? (
            <p className="note">
              Your own photo, re-dressed by the free FASHN VTON try-on model on{' '}
              <a href={SPACE_PAGE} target="_blank" rel="noreferrer">
                Hugging Face
              </a>
              . It shows the garment as UNIQLO photographed it, not in your size: the fit numbers under each item show how your size
              sits. Photos are not saved: download the ones you want to keep.
            </p>
          ) : (
            <p className="note">
              AI-generated from your photos and measurements. Fit and length follow the size chart; check the product page before
              you buy. Photos are not saved: download the ones you want to keep.
            </p>
          )}
          {TRY_ON && stale && <AllowanceNote />}
          {TRY_ON && stale && <CreditNote />}
          {!TRY_ON && done > 0 && remaining !== null && remaining > 0 && (
            <p className="note">
              Shooting again uses one of your {remaining} remaining {remaining === 1 ? 'look' : 'looks'}.
            </p>
          )}
        </div>
      </div>
      {!stale && !TRY_ON && <ComparePanel look={look} />}
      {TRY_ON && !stale && <TryOnSizes />}
      {open && openDone && <Lightbox look={look} view={open} onClose={() => setOpen(null)} onNavigate={setOpen} />}
    </div>
  );
}

function Intro({ input }: { input: ShotInput }) {
  const missing = input.ready ? [] : input.missing;
  const measured = useApp((s) => s.profile.heightCm !== null && s.profile.weightKg !== null);
  const steps = TRY_ON
    ? [
        { label: 'A full-body front photo (a side one too, if you like)', done: !missing.includes('front photo') },
        { label: 'Pick a top and bottoms', done: !missing.includes('something to wear') },
        { label: 'Height and weight, for your size', done: measured },
      ]
    : [
        { label: 'Three photos: front, side, face profile', done: !['front photo', 'side photo', 'face profile'].some((m) => missing.includes(m)) },
        { label: 'Height and weight', done: !missing.includes('height and weight') },
        { label: 'Pick a top and bottoms', done: !missing.includes('something to wear') },
      ];
  const views = engineViews();
  return (
    <div className="lookbook intro">
      <div className="lookbook-head">
        <div className="eyebrow muted">Your fitting room</div>
        <h1 className="lookbook-title">
          See it on <em>you</em>.
        </h1>
        {TRY_ON ? (
          <p className="intro-copy">
            Your own photo, wearing the outfit: only the clothes change, so it's really you. Your measurements give you the
            size to buy and show, in numbers, how it fits.
          </p>
        ) : (
          <p className="intro-copy">
            Three photos and your measurements become four shots of you in the outfit, from the front, three-quarter, side and
            back, like the model on a product page, in the size that fits you.
          </p>
        )}
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
          <>
            <p className="intro-ready">Ready. Press {TRY_ON ? 'Try It On' : 'Make My Shots'}.</p>
            {TRY_ON && <AllowanceNote />}
            {TRY_ON && <CreditNote />}
          </>
        ) : (
          <a className="btn btn-dark intro-start" href="#you">
            Add Your Photos
          </a>
        )}
      </div>
      <div className={`frames frames-${views.length}`} aria-hidden>
        {views.map((view) => (
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
  const input = useShotInput();
  const current = useLooks((s) => (input.ready ? s.looks[input.key] : undefined));
  const latest = useLooks((s) => (s.latest ? s.looks[s.latest] : undefined));
  const look = current ?? latest;
  if (!look) return <Intro input={input} />;
  return <Shots look={look} stale={!current} />;
}
