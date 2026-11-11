// /mcp (vercel.json rewrite -> /api/mcp): FitRoom's MCP server for ChatGPT plugins (api/_lib/mcpServer.ts), stateless
// Streamable HTTP with JSON responses. A bearer token from FitRoom's OAuth (api/oauth.ts) links the shopper's account;
// a token that is present but invalid gets 401 + WWW-Authenticate so ChatGPT signs in again. No token: anonymous tools
// work, and tools that need the account answer with a challenge that makes ChatGPT offer to link FitRoom.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { siteOrigin } from './_lib/account';
import { billingConfig } from './_lib/billing';
import { createFitRoomServer } from './_lib/mcpServer';
import { authChallenge, bearerUser } from './_lib/oauth';
import { clientIp } from './_lib/rateLimit';
import { createWindowLimiter } from './_lib/windowLimit';

const limiter = createWindowLimiter({ limit: 240, windowMs: 60_000 });
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

async function handle(request: Request): Promise<Response> {
  const verdict = limiter.hit(clientIp(request));
  if (!verdict.ok) return new Response('Too many requests', { status: 429, headers: { ...CORS, 'Retry-After': String(verdict.retryAfterS) } });
  const config = billingConfig();
  const origin = siteOrigin(request);
  const auth = config.enabled ? bearerUser(request, origin, config.sessionSecret) : { status: 'none' as const };
  if (auth.status === 'invalid') {
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json', 'WWW-Authenticate': authChallenge(origin, 'invalid_token', 'Sign in to FitRoom again.') },
    });
  }
  const server = createFitRoomServer({ origin, config, user: auth.status === 'ok' ? auth.user : null });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (err: unknown) {
    console.error('[api/mcp] request failed', err instanceof Error ? err.stack ?? err.message : err);
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } finally {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
