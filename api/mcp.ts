// /api/mcp: FitRoom's ChatGPT plugin endpoint (MCP over Streamable HTTP, stateless: a fresh server per request,
// JSON responses, no sessions), so it runs as a plain Vercel function. Connect ChatGPT (developer mode) or any MCP
// client to https://<host>/api/mcp. A GET from a browser returns a short description instead.
// Tools and widget: _lib/mcp/server.ts. Contract: CLAUDE.md, ChatGPT plugin.
// Paid try-ons on (billing.ts): a bearer token from FitRoom's OAuth (api/oauth.ts) is the shopper's FitRoom account;
// one that is present but invalid gets 401 + WWW-Authenticate so ChatGPT signs in again (accounts.ts).
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { siteOrigin } from './_lib/account';
import { billingConfig } from './_lib/billing';
import { authChallenge, bearerUser } from './_lib/oauth';
import { catalogItems } from './_lib/mcp/catalog';
import { SERVER_NAME, SERVER_VERSION, TOOLS, createServer, widgetHtml } from './_lib/mcp/server';
import { tryOnStatus } from './_lib/mcp/tryOn';
import { clientIp } from './_lib/rateLimit';
import { createWindowLimiter } from './_lib/windowLimit';

// ChatGPT calls from OpenAI's servers, so many shoppers share one IP: this only stops floods.
const limiter = createWindowLimiter({ limit: 600, windowMs: 60_000 });

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
}

/** The origin the client used (Vercel sets x-forwarded-host / -proto). */
function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const verdict = limiter.hit(ip);
  if (!verdict.ok) return jsonRpcError(429, 'Too many requests. Try again in a minute.', { 'Retry-After': String(verdict.retryAfterS) });

  const billing = billingConfig();
  const origin = siteOrigin(request);
  const auth = billing.enabled ? bearerUser(request, origin, billing.sessionSecret) : { status: 'none' as const };
  if (auth.status === 'invalid') {
    return jsonRpcError(401, 'Sign in to FitRoom again.', { 'WWW-Authenticate': authChallenge(origin, 'invalid_token', 'Sign in to FitRoom again.') });
  }
  const account = { billing, user: auth.status === 'ok' ? auth.user : null, origin };
  const server = createServer({ ip, account });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (err: unknown) {
    console.error('[mcp] request failed', err instanceof Error ? err.stack ?? err.message : err);
    return jsonRpcError(500, 'FitRoom had a problem. Try again.');
  } finally {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

export async function GET(request: Request): Promise<Response> {
  // Stateless server: no server-to-client SSE stream (the spec's answer is 405).
  if ((request.headers.get('accept') ?? '').includes('text/event-stream')) {
    return withCors(new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
  }
  const info = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    about: "FitRoom's ChatGPT plugin: the size to buy in UNIQLO men's basics, how it fits in numbers, and try-on photos.",
    mcp: `${originOf(request)}/api/mcp`,
    transport: 'streamable-http (POST JSON-RPC)',
    tools: TOOLS.map((t) => t.name),
    catalogItems: catalogItems().length,
    widgetBytes: widgetHtml().length,
    tryOn: tryOnStatus().on ? 'on' : 'off',
    accounts: billingConfig().enabled ? 'FitRoom accounts (OAuth): try-ons come from the linked account' : 'off: monthly free allowance per ChatGPT user',
  };
  return withCors(new Response(JSON.stringify(info, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

export async function DELETE(): Promise<Response> {
  return withCors(new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
}

export async function OPTIONS(): Promise<Response> {
  return withCors(new Response(null, { status: 204 }));
}
