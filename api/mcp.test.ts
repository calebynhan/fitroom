// The ChatGPT plugin endpoint, end to end through the MCP protocol: an SDK client talks to POST /api/mcp exactly as
// ChatGPT would (initialize, tools/list, tools/call, resources/read), and try-on runs against a fake FASHN API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { completeBody, EMPTY_PROFILE, sizingBody, type Profile } from './_lib/fit/profile';
import { sizeAdvice } from './_lib/fit/sizing';
import { DELETE, GET, OPTIONS, POST } from './mcp';
import { catalogItems } from './_lib/mcp/catalog';
import { memoryStore } from './_lib/mcp/quota';
import { createServer, WIDGET_MIME, WIDGET_URI } from './_lib/mcp/server';
import type { TryOnDeps } from './_lib/mcp/tryOn';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function httpClient(): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://fitroom.test/api/mcp'), {
    fetch: (url, init) => POST(new Request(url, init)),
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) })) as CallToolResult;
}

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
const sc = (r: CallToolResult) => r.structuredContent as Record<string, any>;

// Caleb's measurements (CLAUDE.md, Default body) in inches and pounds
const CALEB = { height: 70, weight: 143, chest: 36.2, waist: 29.5, hips: 35.4, inseam: 33.1 };

describe('/api/mcp over HTTP', () => {
  it('lists the three tools, each tied to the widget; try_on takes the photo as a file param', async () => {
    const client = await httpClient();
    expect(client.getServerVersion()?.name).toBe('fitroom');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['recommend_size', 'find_clothes', 'try_on']);
    for (const tool of tools) {
      expect(tool._meta?.ui).toMatchObject({ resourceUri: WIDGET_URI });
      expect(tool._meta?.['openai/outputTemplate']).toBe(WIDGET_URI);
      expect(tool.icons?.[0].mimeType).toBe('image/svg+xml');
    }
    expect(tools[2]._meta?.['openai/fileParams']).toEqual(['photo']);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    expect(tools[2].annotations?.readOnlyHint).toBe(false);
  });

  it('serves the widget as an MCP Apps resource with a CSP for UNIQLO photos', async () => {
    const client = await httpClient();
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(1);
    const { contents } = await client.readResource({ uri: WIDGET_URI });
    const widget = contents[0] as { mimeType: string; text: string; _meta: any };
    expect(widget.mimeType).toBe(WIDGET_MIME);
    expect(widget.text).toContain('ui/initialize');
    expect(widget.text).toContain('openai:set_globals');
    expect(widget._meta.ui.csp.resourceDomains).toContain('https://image.uniqlo.com');
    expect(widget._meta.ui.csp.connectDomains).toEqual([]);
    expect(widget._meta.ui.domain).toBe('https://fitroom.test');
  });

  it("gives the documented sizes for the default body, the same as the web app's sizing", async () => {
    const client = await httpClient();
    const expected: [string, string][] = [
      ['E453754-000', 'S'], // Washable Milano Ribbed Sweater
      ['E422992-000', 'S'], // Crew Neck T-Shirt
      ['E475598-000', 'S'], // Ultra Stretch Pants
      ['E450251-000', '30inch'], // Slim Chino
    ];
    for (const [id, size] of expected) {
      const r = await call(client, 'recommend_size', { product: id, ...CALEB });
      expect(r.isError).toBeFalsy();
      expect(sc(r).size).toBe(size);
      expect(sc(r).card.rows.length).toBeGreaterThan(1);
      expect(text(r)).toContain(`colorDisplayCode=`);
    }
  });

  it('matches web/src/fit sizeAdvice word for word on every catalog item (estimated measurements)', async () => {
    const client = await httpClient();
    const profile: Profile = { ...EMPTY_PROFILE, units: 'metric', heightCm: 183, weightKg: 82 };
    const body = sizingBody(profile)!;
    expect(completeBody(profile)).not.toBeNull();
    for (const item of catalogItems()) {
      const r = await call(client, 'recommend_size', { product: item.id, units: 'metric', height: 183, weight: 82 });
      const web = sizeAdvice(item, body, { pref: 'regular' });
      expect(sc(r).text, item.name).toBe(web?.text ?? sc(r).text);
      expect(sc(r).size, item.name).toBe(web?.size ?? null);
    }
  });

  it('finds a product by name, compares a size the shopper asks about, and honours the fit preference', async () => {
    const client = await httpClient();
    const byName = await call(client, 'recommend_size', { product: 'milano ribbed sweater', color: 'black', ...CALEB, size: 'm' });
    expect(sc(byName).product.id).toBe('E453754-000');
    expect(sc(byName).product.color.name.toLowerCase()).toContain('black');
    expect(sc(byName).size).toBe('M');
    expect(sc(byName).card.sizes).toEqual(['M', 'S']);
    expect(sc(byName).text).toContain('You asked about M');

    const relaxed = await call(client, 'recommend_size', { product: 'E453754-000', ...CALEB, fit: 'relaxed' });
    expect(sc(relaxed).pick.reason).toBe('relaxed');
  });

  it('says what is wrong in shopper words: unknown product, ambiguous name, impossible height', async () => {
    const client = await httpClient();
    const unknown = await call(client, 'recommend_size', { product: 'wool overcoat', ...CALEB });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/isn't in FitRoom's catalog|Which one/);

    const vague = await call(client, 'recommend_size', { product: 't-shirt', ...CALEB });
    expect(vague.isError).toBe(true);
    expect(text(vague)).toMatch(/Which one: .*E\d{6}-\d{3}/);

    const tall = await call(client, 'recommend_size', { product: 'E453754-000', height: 100, weight: 143 });
    expect(tall.isError).toBe(true);
    expect(text(tall)).toContain('Height 100 in is outside');

    const missing = await call(client, 'recommend_size', { product: 'E453754-000', height: 70 });
    expect(text(missing)).toContain('Weight is needed');
  });

  it('searches the catalog by kind, colour and price', async () => {
    const client = await httpClient();
    const r = await call(client, 'find_clothes', { kind: 'pants', color: 'black', maxPrice: 50, limit: 5 });
    const items = sc(r).items as any[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const p of items) {
      expect(p.shape).toBe('pants');
      expect(p.color.name.toLowerCase()).toContain('black');
      expect(p.salePrice ?? p.price).toBeLessThanOrEqual(50);
      expect(p.url).toContain(p.id);
    }
    const tees = await call(client, 'find_clothes', { query: 'supima tee' });
    expect(sc(tees).items[0].id).toBe('E455365-000');
  });

  it("try_on says it isn't switched on without a FASHN key", async () => {
    const client = await httpClient();
    const prev = process.env.FASHN_API_KEY;
    delete process.env.FASHN_API_KEY;
    const r = await call(client, 'try_on', { photo: { download_url: 'https://files.example.com/me.jpg' }, top: { product: 'E453754-000' } });
    if (prev !== undefined) process.env.FASHN_API_KEY = prev;
    expect(r.isError).toBe(true);
    expect(sc(r)).toMatchObject({ kind: 'tryon', status: 'unavailable' });
  });
});

describe('/api/mcp HTTP surface', () => {
  it('describes itself to a browser GET, refuses an SSE GET (stateless), answers CORS preflight', async () => {
    const info = await GET(new Request('https://fitroom.test/api/mcp'));
    expect(info.status).toBe(200);
    const body = await info.json();
    expect(body.mcp).toBe('https://fitroom.test/api/mcp');
    expect(body.catalogItems).toBe(catalogItems().length);

    const sse = await GET(new Request('https://fitroom.test/api/mcp', { headers: { Accept: 'text/event-stream' } }));
    expect(sse.status).toBe(405);
    expect((await DELETE()).status).toBe(405);
    const pre = await OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Mcp-Protocol-Version');
  });
});

// ---- try-on, end to end, against a fake FASHN API ----

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const RESULT = 'data:image/jpeg;base64,/9j/RESULT';

function fakeFashn(opts: { failBottoms?: string } = {}) {
  const runs: { category: string; model: string }[] = [];
  let clock = 1_800_000_000_000;
  const deps: TryOnDeps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://files.example.com/')) return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
      if (url.startsWith('https://image.uniqlo.com/')) return new Response(JPEG);
      if (url === 'https://api.fashn.ai/v1/run') {
        const body = JSON.parse(String(init?.body));
        runs.push({ category: body.inputs.category, model: body.inputs.model_image.slice(0, 30) });
        expect(body.model_name).toBe('tryon-v1.6');
        expect(body.inputs.return_base64).toBe(true);
        expect(body.inputs.model_image.startsWith('data:image/')).toBe(true);
        return Response.json({ id: `p${runs.length}`, error: null });
      }
      const status = url.match(/\/v1\/status\/(p\d+)$/);
      if (status) {
        const run = runs[Number(status[1].slice(1)) - 1];
        if (opts.failBottoms && run.category === 'bottoms') return Response.json({ status: 'failed', error: { name: opts.failBottoms } });
        return Response.json({ status: 'completed', output: [`${RESULT}-${run.category}`] });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return { deps, runs };
}

async function memoryClient(deps: TryOnDeps, env: Record<string, string>, store = memoryStore()): Promise<Client> {
  const server = createServer({ ip: '203.0.113.9', origin: 'https://fitroom.test', env: { FASHN_API_KEY: 'test-key', ...env }, store, deps });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  clients.push(client);
  return client;
}

const PHOTO = { download_url: 'https://files.example.com/me.jpg', file_id: 'file_1', mime_type: 'image/jpeg' };

describe('try_on', () => {
  it('puts the top on, then the pants on that result, and returns the photo to the widget only', async () => {
    const { deps, runs } = fakeFashn();
    const client = await memoryClient(deps, {});
    const r = await call(client, 'try_on', { photo: PHOTO, bottom: { product: 'E475598-000' }, top: { product: 'E453754-000', color: 'black' } }, { 'openai/subject': 'v1/user-a' });
    expect(r.isError).toBeFalsy();
    expect(runs.map((x) => x.category)).toEqual(['tops', 'bottoms']);
    expect(runs[1].model).toBe(`${RESULT}-tops`.slice(0, 30)); // pants go on the photo already wearing the top
    expect(r._meta?.['fitroom/photo']).toBe(`${RESULT}-bottoms`);
    expect(JSON.stringify(r.structuredContent)).not.toContain('base64'); // the model never gets the image
    expect(sc(r)).toMatchObject({ kind: 'tryon', status: 'ok', remaining: 4 });
    expect(text(r)).toContain('not in your size');
  });

  it('keeps the top when the pants fail, and counts it', async () => {
    const { deps } = fakeFashn({ failBottoms: 'PipelineError' });
    const client = await memoryClient(deps, {});
    const r = await call(client, 'try_on', { photo: PHOTO, top: { product: 'E453754-000' }, bottom: { product: 'E475598-000' } }, { 'openai/subject': 'v1/user-b' });
    expect(sc(r).status).toBe('partial');
    expect(r._meta?.['fitroom/photo']).toBe(`${RESULT}-tops`);
    expect(sc(r).message).toContain("didn't go on");
  });

  it('gives 5 free photos per ChatGPT user per month, counts failures as free, and keeps users apart', async () => {
    const store = memoryStore();
    const { deps } = fakeFashn();
    const client = await memoryClient(deps, {}, store);
    const args = { photo: PHOTO, top: { product: 'E453754-000' } };
    for (let i = 0; i < 5; i += 1) expect(sc(await call(client, 'try_on', args, { 'openai/subject': 'v1/user-c' })).status).toBe('ok');
    const sixth = await call(client, 'try_on', args, { 'openai/subject': 'v1/user-c' });
    expect(sc(sixth)).toMatchObject({ status: 'limit', remaining: 0 });
    expect(text(sixth)).toContain('free try-on photos this month');
    expect(text(sixth)).not.toMatch(/upgrade|subscribe|buy more|\$/i); // no upsell inside ChatGPT (plugin guidelines)
    expect(sc(await call(client, 'try_on', args, { 'openai/subject': 'v1/user-d' })).status).toBe('ok');

    const failing = fakeFashn({ failBottoms: 'PoseError' });
    const c2 = await memoryClient(failing.deps, {}, store);
    const bad = await call(c2, 'try_on', { photo: PHOTO, bottom: { product: 'E475598-000' } }, { 'openai/subject': 'v1/user-e' });
    expect(sc(bad)).toMatchObject({ status: 'photo', remaining: 5 });
    expect(text(bad)).toContain('head to toe');
  });

  it('stops at the daily cap for everyone, and refuses a photo link to a private address', async () => {
    const { deps } = fakeFashn();
    const client = await memoryClient(deps, { TRYON_DAILY_CAP: '1' });
    expect(sc(await call(client, 'try_on', { photo: PHOTO, top: { product: 'E453754-000' } }, { 'openai/subject': 'v1/a' })).status).toBe('ok');
    const capped = await call(client, 'try_on', { photo: PHOTO, top: { product: 'E453754-000' } }, { 'openai/subject': 'v1/b' });
    expect(sc(capped).status).toBe('unavailable');

    const c2 = await memoryClient(deps, {});
    const local = await call(c2, 'try_on', { photo: { download_url: 'https://127.0.0.1/me.jpg' }, top: { product: 'E453754-000' } }, { 'openai/subject': 'v1/c' });
    expect(sc(local).status).toBe('photo');
  });

  it('refuses a top passed as pants', async () => {
    const { deps } = fakeFashn();
    const client = await memoryClient(deps, {});
    const r = await call(client, 'try_on', { photo: PHOTO, bottom: { product: 'E453754-000' } }, { 'openai/subject': 'v1/f' });
    expect(text(r)).toContain('pass it as "top"');
  });
});
