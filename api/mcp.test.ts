// The ChatGPT plugin endpoint, end to end through the MCP protocol: an SDK client talks to POST /api/mcp exactly as
// ChatGPT would (initialize, tools/list, tools/call, resources/read), and try-on runs against a fake FASHN API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

process.env.MCP_EVENT_LOGS = '0'; // keep the per-call log lines out of the test output
import { completeBody, EMPTY_PROFILE, sizingBody, type Profile } from './_lib/fit/profile';
import { sizeAdvice } from './_lib/fit/sizing';
import { DELETE, GET, OPTIONS, POST } from './mcp';
import { catalogItems, resolveProduct } from './_lib/mcp/catalog';
import { readStats } from './_lib/mcp/metrics';
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
  it('lists only the tools this deployment can serve: no FASHN key = no try_on, no shared store = no report_fit', async () => {
    const client = await httpClient(); // no FASHN_API_KEY, no Upstash in the test environment
    expect(client.getServerVersion()?.name).toBe('fitroom');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['recommend_size', 'size_chart', 'find_clothes']);
    expect(client.getInstructions()).not.toMatch(/photo|report_fit/);
    for (const tool of tools) {
      expect(tool._meta?.ui).toMatchObject({ resourceUri: WIDGET_URI });
      expect(tool._meta?.['openai/outputTemplate']).toBe(WIDGET_URI);
      expect(tool.icons?.[0].mimeType).toBe('image/svg+xml');
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('with a FASHN key and a shared store it lists all four; try_on takes the photo as a file param, report_fit has no card', async () => {
    const client = await memoryClient(fakeFashn().deps, {});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['recommend_size', 'size_chart', 'find_clothes', 'try_on', 'report_fit']);
    expect(client.getInstructions()).toMatch(/photo of the shopper.*report_fit/);
    expect(tools[3]._meta?.['openai/fileParams']).toEqual(['photo']);
    expect(tools[3].annotations?.readOnlyHint).toBe(false);
    expect(tools[4]._meta?.ui).toBeUndefined(); // a thank-you needs no card
    expect(tools[4].annotations?.readOnlyHint).toBe(false);
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
    expect(widget._meta.ui.domain).toBeUndefined();
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
      expect(sc(r).reportsOn).toBe(false); // no shared store here: the card mustn't invite fit reports
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
    // the size to buy leads (the ChatGPT test showed "YOUR SIZE: M" over "You're an S"); the asked size is labelled
    expect(sc(byName).size).toBe('S');
    expect(sc(byName).asked).toBe('M');
    expect(sc(byName).askedSummary).toMatch(/fit/);
    expect(sc(byName).card.sizes).toEqual(['S', 'M']);
    expect(sc(byName).text).toContain('You asked about M');
    expect(text(byName)).toContain('In the M they asked about:');

    const link = await call(client, 'recommend_size', { product: 'https://www.uniqlo.com/us/en/products/E453754-000/00?colorDisplayCode=09', ...CALEB });
    expect(sc(link).product.color.code).toBe('09'); // the colour the shopper was looking at
    expect(sc(link).buyUrl).toContain('colorDisplayCode=09');

    const relaxed = await call(client, 'recommend_size', { product: 'E453754-000', ...CALEB, fit: 'relaxed' });
    expect(sc(relaxed).pick.reason).toBe('relaxed');
  });

  it('resolves every catalog item by its exact name, and a near name when only one item fits', async () => {
    for (const item of catalogItems()) {
      const r = await resolveProduct(item.name);
      expect(r.ok && r.item.id, item.name).toBe(item.id);
    }
    const near = await resolveProduct('milano ribbed sweater');
    expect(near.ok && near.item.id).toBe('E453754-000');
    expect((await resolveProduct('Ultra Stretch Pants')).ok).toBe(true);
  });

  it('says what is wrong in shopper words: unknown product, ambiguous name, impossible height', async () => {
    const client = await httpClient();
    const unknown = await call(client, 'recommend_size', { product: 'linen trousers xyz', ...CALEB });
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
  const server = createServer({ ip: '203.0.113.9', env: { FASHN_API_KEY: 'test-key', ...env }, store, deps });
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

describe('report_fit and what buyers reported', () => {
  const said = (fit: string, where?: string) => ({ product: 'E453754-000', size: 'S', fit, ...(where ? { where } : {}) });

  it('keeps one anonymous report per person per item, then shows the tallies with the size advice from 5 reports', async () => {
    const store = memoryStore();
    const client = await memoryClient(fakeFashn().deps, {}, store);
    const first = await call(client, 'report_fit', said('too_small', 'chest'), { 'openai/subject': 'v1/buyer-1' });
    expect(first.isError).toBeFalsy();
    expect(text(first)).toContain('Thanks: noted that the Washable Milano Ribbed Sweater in S runs small (chest).');
    expect(text(first)).toContain('once a size has 5 reports');
    const again = await call(client, 'report_fit', said('just_right'), { 'openai/subject': 'v1/buyer-1' });
    expect(sc(again).status).toBe('duplicate');

    for (const [i, fit] of ['just_right', 'just_right', 'just_right', 'too_small'].entries()) {
      await call(client, 'report_fit', said(fit, fit === 'too_small' ? 'chest' : undefined), { 'openai/subject': `v1/buyer-${i + 2}` });
    }
    const advice = await call(client, 'recommend_size', { product: 'E453754-000', ...CALEB });
    expect(sc(advice).reportText).toBe('Shoppers who bought the S: 3 of 5 say it fits; 2 say it runs small (chest).');
    expect(sc(advice).reportsOn).toBe(true);
    expect(sc(advice).reports.S).toMatchObject({ total: 5, just_right: 3, too_small: 2, where: 'chest' });
    expect(text(advice)).toContain('Shoppers who bought the S: 3 of 5 say it fits');
  });

  it('asks again for a size the item does not come in, and for a verdict it does not know', async () => {
    const client = await memoryClient(fakeFashn().deps, {});
    const badSize = await call(client, 'report_fit', { product: 'E453754-000', size: 'XXXXL', fit: 'too_big' }, { 'openai/subject': 'v1/x' });
    expect(text(badSize)).toBe('Which size did they buy? The Washable Milano Ribbed Sweater comes in XXS, XS, S, M, L, XL, XXL, 3XL.');
    const badFit = await call(client, 'report_fit', { product: 'E453754-000', size: 'm', fit: 'meh' }, { 'openai/subject': 'v1/x' });
    expect(text(badFit)).toContain('too small, just right or too big');
    const inch = await call(client, 'report_fit', { product: 'E450251-000', size: '30', fit: 'just_right' }, { 'openai/subject': 'v1/x' });
    expect(text(inch)).toContain('in 30" fits');
  });
});

describe('usage counters', () => {
  it('counts every call by tool and outcome, distinct users per day, and the products asked about; nothing personal', async () => {
    const store = memoryStore();
    const client = await memoryClient(fakeFashn().deps, {}, store);
    await call(client, 'recommend_size', { product: 'E453754-000', ...CALEB }, { 'openai/subject': 'v1/a' });
    await call(client, 'recommend_size', { product: 'E475598-000', height: 70, weight: 143 }, { 'openai/subject': 'v1/b' });
    await call(client, 'recommend_size', { product: 'nope nope', ...CALEB }, { 'openai/subject': 'v1/a' });
    await call(client, 'find_clothes', { query: 'zzzz' }, { 'openai/subject': 'v1/a' });
    await call(client, 'try_on', { photo: PHOTO, top: { product: 'E453754-000' } }, { 'openai/subject': 'v1/c' });
    const stats = await readStats(store, 2);
    const today = stats.days[0];
    expect(today.users).toBe(3);
    expect(today.calls).toEqual({
      'recommend_size:ok': 1,
      'recommend_size:borderline': 1,
      'recommend_size:error': 1,
      'find_clothes:empty': 1,
      'try_on:ok': 1,
    });
    expect(today.products).toMatchObject({ 'recommend_size:E453754-000': 1, 'recommend_size:E475598-000': 1, 'try_on:E453754-000': 1 });
    expect(Object.keys(today.meanMs).sort()).toEqual(['find_clothes', 'recommend_size', 'try_on']);
    expect(stats.week).toEqual({ users: 3, activeDaysPerUser: 1 });
    expect(JSON.stringify(stats)).not.toMatch(/v1\/|70|143|36\.2/); // no ids, no measurements
  });

  it('shows the counts only with the owner token', async () => {
    const prev = process.env.MCP_STATS_TOKEN;
    delete process.env.MCP_STATS_TOKEN;
    expect((await GET(new Request('https://fitroom.test/api/mcp?stats=anything'))).status).toBe(404);
    process.env.MCP_STATS_TOKEN = 'owner-secret-123';
    expect((await GET(new Request('https://fitroom.test/api/mcp?stats=wrong'))).status).toBe(404);
    const ok = await GET(new Request('https://fitroom.test/api/mcp?stats=owner-secret-123'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.store).toBe('memory');
    expect(body.days).toHaveLength(14);
    if (prev === undefined) delete process.env.MCP_STATS_TOKEN;
    else process.env.MCP_STATS_TOKEN = prev;
  });
});

describe('size_chart: questions about the item, no height or weight needed', () => {
  it("answers an item's chart, how it runs and where a chest falls", async () => {
    const client = await httpClient();
    const r = await call(client, 'size_chart', { product: 'Washable Milano Ribbed Sweater', chest: 36 });
    expect(r.isError).toBeFalsy();
    const chart = sc(r).charts[0];
    expect(chart.columns[0]).toBe('Chest (body)');
    expect(chart.rows.map((x: any) => x.label)).toContain('M');
    expect(chart.match).toMatchObject({ size: 'S', fits: true });
    expect(chart.cut.ease).toMatch(/close|regular|relaxed|oversized/);
    expect(text(r)).toContain('UNIQLO calls it a');
    expect(text(r)).toContain('How it runs:');
    expect(text(r)).toContain("A 36 in chest is an S by UNIQLO's chart.");
    expect(text(r)).toContain('use recommend_size with their height and weight');
  });

  it('answers "what does a men\'s medium measure" without a product, and a 32 in waist across letter and inch sizes', async () => {
    const client = await httpClient();
    const tops = await call(client, 'size_chart', { size: 'M' });
    expect(sc(tops).general).toBe(true);
    expect(text(tops)).toMatch(/- M: Chest \(body\) [\d.]+–[\d.]+ in/);
    const pants = await call(client, 'size_chart', { kind: 'bottom', waist: 32 });
    const titles = sc(pants).charts.map((c: any) => c.title);
    expect(titles).toEqual(["UNIQLO men's pants (S–XXL)", "UNIQLO men's jeans and chinos (inch sizes)"]);
    expect(text(pants)).toMatch(/A 32 in waist is an? \S+ by UNIQLO's chart\./);
    expect(sc(pants).charts[0].rows.map((r: any) => r.label)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
  });

  it('keeps the colour of a pasted link and refuses what it does not cover', async () => {
    const client = await httpClient();
    const r = await call(client, 'size_chart', { product: 'https://www.uniqlo.com/us/en/products/E453754-000/00?colorDisplayCode=09' });
    expect(sc(r).product.color.code).toBe('09');
    const coat = await call(client, 'size_chart', { product: 'puffer jacket' });
    expect(coat.isError).toBe(true);
    expect(text(coat)).toContain("can't size that item yet, so don't guess a size");
  });
});

describe('items FitRoom does not cover', () => {
  it('says so plainly, so the model does not fill in a guess (ChatGPT test, case 10)', async () => {
    const client = await httpClient();
    for (const product of ['puffer jacket', 'Ultra Light Down Jacket', 'oxford shirt', 'hoodie', 'swim shorts']) {
      const r = await call(client, 'recommend_size', { product, ...CALEB });
      expect(r.isError, product).toBe(true);
      expect(text(r), product).toContain("don't guess a size");
    }
    const womens = await call(client, 'recommend_size', { product: "women's wide jeans", ...CALEB });
    expect(text(womens)).toContain("women's and kids' sizing isn't covered yet");
    const browse = await call(client, 'find_clothes', { query: 'puffer jacket' });
    expect(sc(browse)).toMatchObject({ status: 'not_covered', items: [] });
    // a bare "shirts" means T-shirts to most people: browse, don't refuse
    expect(sc(await call(client, 'find_clothes', { query: 'black shirts' })).status).not.toBe('not_covered');
    // T-shirts and sweatshirts are not "shirts"
    expect((await call(client, 'find_clothes', { query: 'crew neck t-shirt' })).isError).toBeFalsy();
    expect(sc(await call(client, 'find_clothes', { query: 'crew neck t-shirt' })).items.length).toBeGreaterThan(0);
  });
});
