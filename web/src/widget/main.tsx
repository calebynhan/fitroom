// Entry of the ChatGPT panel bundle (vite.widget.config.ts -> dist/widget/fitroom-tryon.js), loaded by the MCP
// server's UI resource (api/_lib/mcpServer.ts widgetHtml).
import { createRoot } from 'react-dom/client';
import { connectBridge } from './bridge';
import { Panel } from './Panel';
import { WIDGET_CSS } from './styles';

const style = document.createElement('style');
style.textContent = WIDGET_CSS;
document.head.appendChild(style);

const root = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
const view = createRoot(root);

connectBridge().then(
  (bridge) => view.render(<Panel bridge={bridge} />),
  (err: unknown) => {
    console.error('[fitroom] bridge failed', err);
    view.render(<p style={{ padding: 16 }}>FitRoom couldn't connect to ChatGPT. Reload the conversation and try again.</p>);
  },
);
