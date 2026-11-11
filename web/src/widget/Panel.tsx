// The FitRoom panel ChatGPT shows for try_on: the shopper's photo wearing the outfit, the size to buy per item, and
// links to UNIQLO. Follows ChatGPT's UI guidelines: system fonts and colours, no logo (ChatGPT shows it), FitRoom's
// ink only on the main button. Never sells anything: out of try-ons, it says so and links to an informational page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_PROFILE, sizingBody } from '../body/profile';
import { colorLabel, formatPrice } from '../catalog/types';
import { sizeAdvice } from '../fit/sizing';
import { preparePhoto } from '../photos/prepare';
import { sharpenResult } from '../tryon/composite';
import { loadGarmentPhoto } from '../tryon/garment';
import { runSpace, SPACE_PAGE } from '../tryon/space';
import type { Bridge } from './bridge';
import { answerText, panelData, tryOn, type Deps, type PanelData, type Phase, type ToolAnswer } from './run';

interface Saved {
  done?: boolean;
  fileId?: string;
  note?: string;
}

function sizeLines(data: PanelData): { name: string; color: string; price: string; url: string; size: string | null }[] {
  const body = data.body ? sizingBody({ ...EMPTY_PROFILE, heightCm: data.body.heightCm, weightKg: data.body.weightKg }) : null;
  return data.items.map(({ item, colorCode }) => ({
    name: item.name,
    color: colorLabel(item, colorCode),
    price: formatPrice(item),
    url: item.url,
    size: body ? (sizeAdvice(item, body)?.text ?? null) : null,
  }));
}

/** What the model should know once the photo is made: the outfit and the sizes (never the photo itself). */
function modelSummary(data: PanelData, phase: Phase): string {
  const lines = sizeLines(data).map((l) => `${l.name} (${l.color}): ${l.size ?? 'size needs height and weight'}`);
  const status = phase.kind === 'done' ? `Try-on photo made${phase.note ? ` (${phase.note})` : ''}.` : phase.kind === 'error' ? `Try-on failed: ${phase.message}` : '';
  return [status, ...lines].filter(Boolean).join('\n');
}

function dataUrlFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(',');
  const type = head.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
  return new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type });
}

export function Panel({ bridge }: { bridge: Bridge }) {
  const [result, setResult] = useState<ToolAnswer | null>(bridge.lastResult);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [left, setLeft] = useState<number | null | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(false);
  const data = panelData(result);

  // Subscribe, then catch up: the result can arrive between the first render and this effect.
  useEffect(() => {
    const stop = bridge.onResult(setResult);
    if (bridge.lastResult) setResult(bridge.lastResult);
    return stop;
  }, [bridge]);
  useEffect(() => {
    if (data) setLeft(data.account.user ? data.account.user.left : undefined);
  }, [data]);

  const start = useCallback(async () => {
    if (!data || controller.current) return;
    const deps: Deps = {
      callTool: async (name, args) => {
        const answer = await bridge.callTool(name, args);
        const account = answer.structuredContent?.account as PanelData['account'] | undefined;
        if (account?.user) setLeft(account.user.left);
        return answer;
      },
      fetchFn: (input, init) => fetch(input, init),
      prepare: (file) => preparePhoto(file, 'front'),
      garment: loadGarmentPhoto,
      run: runSpace,
      sharpen: sharpenResult,
    };
    const ac = new AbortController();
    controller.current = ac;
    const final = await tryOn(data, deps, setPhase, ac.signal);
    controller.current = null;
    setPhase(final);
    void bridge.updateModelContext(modelSummary(data, final));
    if (final.kind === 'done') {
      // keep the photo with the conversation, so it is there when the chat is reopened (and the model can see it)
      try {
        const fileId = await bridge.uploadImage(dataUrlFile(final.image, 'fitroom-try-on.jpg'));
        if (fileId) bridge.saveState({ done: true, fileId, note: final.note }, modelSummary(data, final), [fileId]);
        else bridge.saveState({ done: true, note: final.note }, modelSummary(data, final), []);
      } catch {
        bridge.saveState({ done: true, note: final.note }, modelSummary(data, final), []);
      }
    }
  }, [data, bridge]);

  // First render of this try_on: run it once. Reopened later: show the saved photo instead of running again.
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    const saved = bridge.savedState<Saved>();
    if (saved?.done) {
      if (saved.fileId) {
        void bridge.fileUrl(saved.fileId).then((url) => setPhase(url ? { kind: 'done', image: url, note: saved.note } : { kind: 'idle' }));
      } else setPhase({ kind: 'idle' });
      return;
    }
    void start();
  }, [data, bridge, start]);

  if (!result) return <p className="muted pad">Opening the fitting room…</p>;
  if (!data) return <p className="pad warn">{answerText(result) || 'This try-on could not be opened.'}</p>;

  const names = data.items.map((i) => `${i.item.name} in ${colorLabel(i.item, i.colorCode)}`);
  const lines = sizeLines(data);
  return (
    <div className="panel">
      <div className="head">
        <p className="eyebrow muted">Your fitting room</p>
        <h2 className="title">{names.join(', with ')}</h2>
      </div>
      <div className={`frame frame-${phase.kind}`}>
        {phase.kind === 'done' && <img src={phase.image} alt={`You wearing ${names.join(' and ')}`} />}
        {phase.kind === 'working' && (
          <div className="status" role="status">
            <span className="bar">
              <span />
            </span>
            <span>{phase.status}</span>
            <button type="button" className="link" onClick={() => controller.current?.abort()}>
              Cancel
            </button>
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="status" role="alert">
            <span className="warn">{phase.message}</span>
            {phase.retryable && (
              <button type="button" className="btn" onClick={() => void start()}>
                Try Again
              </button>
            )}
          </div>
        )}
        {phase.kind === 'empty' && (
          <div className="status" role="alert">
            <span>{phase.message.replace(/ How try-ons work: \S+$/, '')}</span>
            <button type="button" className="link" onClick={() => void bridge.openLink(data.info)}>
              How try-ons work
            </button>
          </div>
        )}
        {phase.kind === 'idle' && (
          <div className="status">
            <button type="button" className="btn" onClick={() => void start()}>
              Try It On
            </button>
          </div>
        )}
      </div>
      {phase.kind === 'done' && phase.note && <p className="note warn">{phase.note}</p>}
      <ul className="items">
        {lines.map((l) => (
          <li key={l.name}>
            <div className="item-head">
              <strong>{l.name}</strong>
              <span className="muted">
                {l.color} · {l.price}
              </span>
            </div>
            <p className="size">{l.size ?? 'Tell ChatGPT your height and weight for the size to buy.'}</p>
            <button type="button" className="link" onClick={() => void bridge.openLink(l.url)}>
              View on UNIQLO
            </button>
          </li>
        ))}
      </ul>
      <p className="note muted">
        Your own photo, re-dressed by the free{' '}
        <button type="button" className="link inline" onClick={() => void bridge.openLink(SPACE_PAGE)}>
          FASHN VTON
        </button>{' '}
        try-on model on Hugging Face. It shows the garment as UNIQLO photographed it, not in your size: the size line says how
        yours fits. FitRoom never stores your photo.
        {left !== undefined && left !== null && ` Try-ons left on your FitRoom account: ${left}.`}
      </p>
    </div>
  );
}
