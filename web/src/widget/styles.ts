// Panel styles: ChatGPT's system font and colours (host CSS variables, with system fallbacks), light and dark. FitRoom
// shows only in the flat, square-cornered layout and the ink main button (ChatGPT UI guidelines: brand on accents).
export const WIDGET_CSS = `
:root { color-scheme: light dark; }
[data-theme="light"] { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body {
  font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: var(--font-text-md-size, 15px);
  line-height: var(--font-text-md-line-height, 1.5);
  color: var(--color-text-primary, CanvasText);
  -webkit-font-smoothing: antialiased;
}
.panel { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.pad { padding: 16px; margin: 0; }
.head { display: flex; flex-direction: column; gap: 4px; }
.eyebrow { margin: 0; font-size: var(--font-text-xs-size, 11px); letter-spacing: 0.16em; text-transform: uppercase; }
.title { margin: 0; font-size: var(--font-heading-sm-size, 17px); line-height: var(--font-heading-sm-line-height, 1.3); font-weight: var(--font-weight-semibold, 600); }
.muted { color: var(--color-text-secondary, GrayText); }
.warn { color: var(--color-text-danger, #8e2a21); }
.frame { position: relative; width: 100%; max-width: 420px; aspect-ratio: 3 / 4; background: var(--color-background-secondary, rgba(127, 127, 127, 0.08)); border: 1px solid var(--color-border-secondary, rgba(127, 127, 127, 0.25)); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.frame-done { aspect-ratio: auto; background: none; }
.frame img { display: block; width: 100%; height: auto; }
.status { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; font-size: var(--font-text-sm-size, 14px); }
.bar { width: 160px; height: 2px; background: var(--color-border-secondary, rgba(127, 127, 127, 0.3)); overflow: hidden; }
.bar > span { display: block; width: 40%; height: 2px; background: var(--color-text-primary, CanvasText); animation: slide 1.4s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
@media (prefers-reduced-motion: reduce) { .bar > span { animation: none; width: 100%; opacity: 0.4; } }
.btn { height: 40px; padding: 0 16px; border: 1px solid #111; border-radius: 0; background: #111; color: #fff; font: inherit; font-size: 12px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
[data-theme="dark"] .btn { border-color: #f4f1ec; background: #f4f1ec; color: #111; }
.link { background: none; border: 0; padding: 0; font: inherit; font-size: var(--font-text-sm-size, 14px); color: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; align-self: flex-start; }
.link.inline { font-size: inherit; }
.status .link { align-self: center; }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.items li { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; border-top: 1px solid var(--color-border-tertiary, rgba(127, 127, 127, 0.2)); }
.item-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.size { margin: 0; font-size: var(--font-text-sm-size, 14px); }
.note { margin: 0; font-size: var(--font-text-xs-size, 12px); line-height: 1.5; }
button:focus-visible { outline: 2px solid var(--color-ring-primary, Highlight); outline-offset: 2px; }
`;
