import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const API_DIR = fileURLToPath(new URL('../api', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Serves api/<name>.ts (Web-standard `export async function POST(request)`) during `vite dev`, like Vercel does in prod. */
function devApi(): Plugin {
  return {
    name: 'fitroom-dev-api',
    configureServer(server) {
      const env = loadEnv('development', REPO_ROOT, '');
      // Server-side settings from ../.env.local for the functions (the shell's own environment wins).
      const SERVER_ENV = /^(OPENAI_API_KEY|GOOGLE_CLIENT_ID|SESSION_SECRET|STRIPE_\w+|FREE_LOOKS|PACK_\w+|BILLING_\w+|KV_REST_API_\w+|UPSTASH_REDIS_REST_\w+|APP_URL|OAUTH_\w+|VITE_TRYON_SPACE)$/;
      for (const [k, v] of Object.entries(env)) if (SERVER_ENV.test(k) && v && !process.env[k]) process.env[k] = v;

      // The ChatGPT panel bundle (npm run build:widget), served like the deployed /widget/ files.
      server.middlewares.use('/widget', (req, res, next) => {
        const file = `${WEB_DIR}/dist/widget${(req.url ?? '').split('?')[0]}`;
        if (!/^\/[\w.-]+\.js$/.test((req.url ?? '').split('?')[0]) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(readFileSync(file));
      });

      server.middlewares.use(async (req, res, next) => {
        // Same rewrites as vercel.json: the MCP server and its OAuth discovery / endpoints.
        const url = req.url ?? '';
        const [path, query = ''] = url.split('?');
        const rewritten =
          path === '/mcp'
            ? `/api/mcp${query ? `?${query}` : ''}`
            : path.startsWith('/.well-known/oauth-protected-resource')
              ? '/api/oauth?step=resource'
              : path.startsWith('/.well-known/oauth-authorization-server')
                ? '/api/oauth?step=server'
                : /^\/api\/oauth\/[a-z]+$/.test(path)
                  ? `/api/oauth?step=${path.split('/').pop()}${query ? `&${query}` : ''}`
                  : url;
        if (rewritten !== url) req.url = rewritten;
        const match = req.url?.match(/^\/api\/([a-z]+)(?:\?|$)/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(`${API_DIR}/${match[1]}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            res.end();
            return;
          }
          const headers = new Headers();
          Object.entries(req.headers).forEach(([k, v]) => typeof v === 'string' && headers.set(k, v));
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: hasBody ? await readBody(req) : undefined,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err: unknown) {
          server.config.logger.error(`[dev-api] ${err instanceof Error ? err.stack : String(err)}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'API crashed in dev' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  resolve: { alias: { '@api': `${API_DIR}/_lib` } },
  server: {
    fs: { allow: [REPO_ROOT] },
    // Same as the vercel.json rewrite: UNIQLO's image CDN sends no CORS headers, so product photos come via this site.
    proxy: { '/uniqlo': { target: 'https://image.uniqlo.com', changeOrigin: true, rewrite: (path) => path.replace(/^\/uniqlo/, '') } },
  },
});
