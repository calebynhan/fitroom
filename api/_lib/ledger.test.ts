import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LedgerError, memoryLedger, REFUND_WINDOW_MS, upstashLedger, type Ledger } from './ledger';

const FREE = 5;

/** The ledger rules, run against both implementations so the Lua and the in-memory version can't drift apart. */
function rules(name: string, make: () => Ledger | Promise<Ledger>) {
  describe(name, () => {
    let sub = 0;
    const person = () => `user-${Date.now()}-${(sub += 1)}`;

    it('spends the free looks first, then paid ones, then refuses', async () => {
      const l = await make();
      const u = person();
      for (let i = 1; i <= FREE; i += 1) {
        const r = await l.charge(u, 'a@b.c', `look-${i}`, FREE, 1000);
        expect(r).toEqual({ ok: true, source: 'free', balance: { freeUsed: i, credits: 0 } });
      }
      expect(await l.charge(u, 'a@b.c', 'look-6', FREE, 1000)).toEqual({ ok: false, balance: { freeUsed: FREE, credits: 0 } });
      expect(await l.credit(u, 'a@b.c', 'cs_1', 2)).toEqual({ credited: true, balance: { freeUsed: FREE, credits: 2 } });
      expect(await l.charge(u, 'a@b.c', 'look-6', FREE, 1000)).toEqual({ ok: true, source: 'paid', balance: { freeUsed: FREE, credits: 1 } });
      expect(await l.balance(u)).toEqual({ freeUsed: FREE, credits: 1 });
    });

    it('never charges the same look twice', async () => {
      const l = await make();
      const u = person();
      await l.charge(u, 'a@b.c', 'look-1', FREE);
      expect(await l.charge(u, 'a@b.c', 'look-1', FREE)).toEqual({ ok: true, source: 'repeat', balance: { freeUsed: 1, credits: 0 } });
    });

    it('gives a look back within the window, once, to where it came from', async () => {
      const l = await make();
      const u = person();
      await l.credit(u, 'a@b.c', 'cs_1', 1);
      for (let i = 0; i < FREE; i += 1) await l.charge(u, 'a@b.c', `f-${i}`, FREE, 1000);
      await l.charge(u, 'a@b.c', 'paid-1', FREE, 1000);
      expect(await l.refund(u, 'paid-1', 1000 + REFUND_WINDOW_MS)).toEqual({ refunded: true, balance: { freeUsed: FREE, credits: 1 } });
      expect(await l.refund(u, 'paid-1', 2000)).toEqual({ refunded: false, reason: 'none', balance: { freeUsed: FREE, credits: 1 } });
      expect(await l.refund(u, 'f-0', 2000)).toEqual({ refunded: true, balance: { freeUsed: FREE - 1, credits: 1 } });
      expect(await l.refund(u, 'f-1', 1001 + REFUND_WINDOW_MS)).toEqual({ refunded: false, reason: 'late', balance: { freeUsed: FREE - 1, credits: 1 } });
      // a refunded look can be charged again (a retry that works)
      expect(await l.charge(u, 'a@b.c', 'f-0', FREE, 3000)).toMatchObject({ ok: true, source: 'free' });
    });

    it('credits a payment once however often it is reported', async () => {
      const l = await make();
      const u = person();
      await l.credit(u, 'a@b.c', 'cs_same', 20);
      expect(await l.credit(u, 'a@b.c', 'cs_same', 20)).toEqual({ credited: false, balance: { freeUsed: 0, credits: 20 } });
      expect(await l.credit(u, 'a@b.c', 'cs_other', 20)).toEqual({ credited: true, balance: { freeUsed: 0, credits: 40 } });
    });

    it('keeps people apart', async () => {
      const l = await make();
      const [a, b] = [person(), person()];
      await l.charge(a, 'a@b.c', 'look', FREE);
      expect(await l.charge(b, 'b@b.c', 'look', FREE)).toMatchObject({ ok: true, source: 'free' });
      expect(await l.balance(b)).toEqual({ freeUsed: 1, credits: 0 });
    });

    it('lets nothing through with zero free looks and no credits', async () => {
      const l = await make();
      expect(await l.charge(person(), 'a@b.c', 'look', 0)).toEqual({ ok: false, balance: { freeUsed: 0, credits: 0 } });
    });
  });
}

rules('memory ledger', () => memoryLedger());

// ---- The Upstash ledger against a real Redis (the Lua scripts run for real), when redis-server is installed. ----

type Reply = string | number | null | Error | Reply[];

function parse(buf: Buffer, i: number): { value: Reply; end: number } | null {
  const nl = buf.indexOf('\r\n', i);
  if (nl < 0) return null;
  const line = buf.toString('utf8', i + 1, nl);
  switch (String.fromCharCode(buf[i])) {
    case '+':
      return { value: line, end: nl + 2 };
    case '-':
      return { value: new Error(line), end: nl + 2 };
    case ':':
      return { value: Number(line), end: nl + 2 };
    case '$': {
      const n = Number(line);
      if (n < 0) return { value: null, end: nl + 2 };
      if (buf.length < nl + 4 + n) return null;
      return { value: buf.toString('utf8', nl + 2, nl + 2 + n), end: nl + 4 + n };
    }
    case '*': {
      const n = Number(line);
      if (n < 0) return { value: null, end: nl + 2 };
      const items: Reply[] = [];
      let j = nl + 2;
      for (let k = 0; k < n; k += 1) {
        const r = parse(buf, j);
        if (!r) return null;
        items.push(r.value);
        j = r.end;
      }
      return { value: items, end: j };
    }
    default:
      throw new Error(`bad reply ${buf.toString('utf8', i, nl)}`);
  }
}

/** A tiny RESP client: enough to play Upstash's REST API in front of a local Redis. */
function respClient(socket: Socket) {
  let buf = Buffer.alloc(0);
  const waiting: ((r: Reply) => void)[] = [];
  socket.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (let r = parse(buf, 0); r && waiting.length; r = parse(buf, 0)) {
      buf = buf.subarray(r.end);
      waiting.shift()!(r.value);
    }
  });
  return (args: string[]) =>
    new Promise<Reply>((resolve) => {
      waiting.push(resolve);
      socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`);
    });
}

const hasRedis = spawnSync('redis-server', ['--version']).status === 0;
const UPSTASH = 'https://upstash.test';

describe.skipIf(!hasRedis)('upstash ledger (real Redis)', () => {
  let server: ChildProcess;
  let socket: Socket;
  let send: (args: string[]) => Promise<Reply>;
  const port = 20000 + Math.floor(Math.random() * 20000);

  beforeAll(async () => {
    server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !socket; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      socket = await new Promise<Socket>((resolve) => {
        const s = createConnection(port, '127.0.0.1');
        s.once('connect', () => resolve(s));
        s.once('error', () => resolve(undefined as unknown as Socket));
      });
    }
    send = respClient(socket);
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== UPSTASH) return real(input, init);
      if (new Headers(init?.headers).get('authorization') !== 'Bearer tok') return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const reply = await send(JSON.parse(String(init?.body)) as string[]);
      return reply instanceof Error ? Response.json({ error: reply.message }, { status: 400 }) : Response.json({ result: reply });
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    socket?.destroy();
    server?.kill();
  });

  rules('scripts', () => upstashLedger(`${UPSTASH}/`, 'tok'));

  it('says so when Upstash refuses', async () => {
    await expect(upstashLedger(UPSTASH, 'wrong').balance('x')).rejects.toBeInstanceOf(LedgerError);
  });
});

describe('upstash ledger (offline)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns an unreachable Upstash into a LedgerError', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(upstashLedger(UPSTASH, 'tok').charge('u', 'e', 'look', 5)).rejects.toThrow(/unreachable/);
  });
});
