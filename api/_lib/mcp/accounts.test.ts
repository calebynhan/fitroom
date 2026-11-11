// try_on with paid try-ons on: the linked FitRoom account's looks are spent (the same ledger as the website), the
// owner and exempt accounts never pay, a photo that isn't made is given back, and an empty account is told why with
// an informational link: never a price or a checkout (ChatGPT plugin rules).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingConfig } from '../billing';
import { ledger, resetLedger } from '../ledger';
import { memoryStore } from './quota';
import type { Store } from './store';
import { createServer } from './server';
import type { TryOnDeps } from './tryOn';

const ORIGIN = 'https://fitroom.test';
const ME = { sub: 'google-31', email: 'shopper@example.com' };
const PHOTO = { download_url: 'https://files.example.com/me.jpg', file_id: 'file_1', mime_type: 'image/jpeg' };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const BILLING_ENV = { GOOGLE_CLIENT_ID: 'g.apps.googleusercontent.com', SESSION_SECRET: 's'.repeat(40) };

function fakeFashn(fail = false) {
  let runs = 0;
  let clock = 1_800_000_000_000;
  const deps: TryOnDeps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (input) => {
      const url = String(input);
      if (url.startsWith('https://files.example.com/')) return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
      if (url.startsWith('https://image.uniqlo.com/')) return new Response(JPEG);
      if (url === 'https://api.fashn.ai/v1/run') return Response.json({ id: `p${(runs += 1)}`, error: null });
      if (/\/v1\/status\/p\d+$/.test(url)) {
        return fail ? Response.json({ status: 'failed', error: { name: 'PipelineError' } }) : Response.json({ status: 'completed', output: ['data:image/jpeg;base64,/9j/OK'] });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return { deps, runs: () => runs };
}

const clients: Client[] = [];
async function client(opts: { user?: typeof ME | null; billing?: Record<string, string>; fail?: boolean; store?: Store; env?: Record<string, string> } = {}) {
  const fashn = fakeFashn(opts.fail);
  const billing = billingConfig({ ...BILLING_ENV, ...opts.billing } as NodeJS.ProcessEnv);
  const server = createServer({
    ip: '203.0.113.7',
    env: { FASHN_API_KEY: 'test-key', ...opts.env },
    store: opts.store ?? memoryStore(),
    deps: fashn.deps,
    account: { billing, user: opts.user === undefined ? ME : opts.user, origin: ORIGIN },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(b);
  clients.push(c);
  return { c, runs: fashn.runs };
}

const tryOn = async (c: Client) =>
  (await c.callTool({ name: 'try_on', arguments: { photo: PHOTO, top: { product: 'E453754-000' } }, _meta: { 'openai/subject': 'v1/someone' } })) as CallToolResult;
const sc = (r: CallToolResult) => r.structuredContent as Record<string, any>;

beforeEach(() => {
  resetLedger();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  delete process.env.BILLING_EXEMPT_EMAILS;
  vi.restoreAllMocks();
});

describe('try_on with FitRoom accounts', () => {
  it('spends one of the linked account’s try-ons per photo and says how many are left', async () => {
    const { c, runs } = await client();
    const r = await tryOn(c);
    expect(r.isError).toBeFalsy();
    expect(sc(r)).toMatchObject({ status: 'ok', remaining: 4, remainingText: '4 try-ons left on your FitRoom account.', resetsAt: null });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 1, credits: 0 });
    await tryOn(c); // every photo is a new paid image
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 2, credits: 0 });
    expect(runs()).toBe(2);
  });

  it('uses try-ons bought on the website once the free ones are gone', async () => {
    await ledger().credit(ME.sub, ME.email, 'cs_test_x', 20);
    const { c } = await client({ billing: { FREE_LOOKS: '0' } });
    const r = await tryOn(c);
    expect(sc(r)).toMatchObject({ status: 'ok', remaining: 19 });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 19 });
  });

  it('asks ChatGPT to link FitRoom when no account is linked, before any work', async () => {
    const { c, runs } = await client({ user: null });
    const r = await tryOn(c);
    expect(r.isError).toBe(true);
    expect(sc(r).status).toBe('signin');
    expect((r._meta as Record<string, string[]>)['mcp/www_authenticate'][0]).toContain('resource_metadata=');
    expect(runs()).toBe(0);
  });

  it('gives the try-on back when no photo was made', async () => {
    const { c } = await client({ fail: true });
    const r = await tryOn(c);
    expect(r.isError).toBe(true);
    expect(sc(r)).toMatchObject({ remaining: 5, remainingText: '5 try-ons left on your FitRoom account.' });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('tells an empty account why, with an informational link and no price or checkout', async () => {
    const { c, runs } = await client({ billing: { FREE_LOOKS: '0' } });
    const r = await tryOn(c);
    expect(sc(r).status).toBe('limit');
    expect(sc(r).message).toContain(`${ORIGIN}/try-ons.html`);
    expect(sc(r).message).not.toMatch(/buy|checkout|stripe|\$|price|pack/i);
    expect(runs()).toBe(0);
  });

  it('never charges an exempt account (the owner), and says nothing about a count', async () => {
    process.env.BILLING_EXEMPT_EMAILS = ME.email;
    const { c } = await client({ billing: { FREE_LOOKS: '0' } });
    const r = await tryOn(c);
    expect(sc(r)).toMatchObject({ status: 'ok', remaining: null, remainingText: null });
    expect(await ledger().balance(ME.sub)).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('still stops at the daily cap for everyone, without charging the account', async () => {
    const store = memoryStore();
    const first = await client({ store, env: { TRYON_DAILY_CAP: '1' } });
    expect((await tryOn(first.c)).isError).toBeFalsy();
    const second = await client({ store, env: { TRYON_DAILY_CAP: '1' }, user: { sub: 'google-32', email: 'other@example.com' } });
    const r = await tryOn(second.c);
    expect(sc(r).status).toBe('unavailable');
    expect(await ledger().balance('google-32')).toEqual({ freeUsed: 0, credits: 0 });
  });

  it('keeps the monthly allowance per ChatGPT user when paid try-ons are off', async () => {
    const { c } = await client({ billing: { GOOGLE_CLIENT_ID: '' }, user: null });
    const r = await tryOn(c);
    expect(sc(r)).toMatchObject({ status: 'ok', remaining: 4, remainingText: '4 free try-on photos left this month.' });
    const tools = (await c.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(['recommend_size', 'size_chart', 'find_clothes', 'try_on', 'report_fit']);
  });
});
