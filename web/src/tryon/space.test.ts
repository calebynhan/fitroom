import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A fake gradio job: the test pushes messages into it; it never ends unless told to. */
function fakeJob() {
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  const job = {
    submitted: false,
    cancel: vi.fn(async () => undefined),
    push(msg: unknown) {
      queue.push(msg);
      wake?.();
    },
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          while (queue.length === 0) await new Promise<void>((r) => (wake = r));
          return { value: queue.shift(), done: false };
        },
      };
    },
  };
  return job;
}

let job: ReturnType<typeof fakeJob>;
vi.mock('@gradio/client', () => ({
  Client: {
    connect: vi.fn(async () => ({
      submit: () => {
        job.submitted = true;
        return job;
      },
    })),
  },
}));

const blob = () => new Blob(['x'], { type: 'image/jpeg' });

async function load() {
  vi.resetModules();
  return import('./space');
}

beforeEach(() => {
  job = fakeJob();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Space errors', () => {
  it('recognises the ZeroGPU allowance running out', async () => {
    const { describeSpaceError } = await load();
    const e = describeSpaceError('You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota');
    expect(e).toMatchObject({ quota: true, retryable: true });
    expect(e.message).toMatch(/free GPU time for your connection is used up/);
  });

  it("reads gradio's own busy and abort messages as busy, not as a bad photo", async () => {
    const { describeSpaceError } = await load();
    for (const said of ['This application is currently busy. Please try again.', 'GPU task aborted', 'No GPU was available after 60s. Retry later', 'Queue is full']) {
      expect(describeSpaceError(said).message, said).toMatch(/busy right now/);
    }
    expect(describeSpaceError('Connection errored out.').message).toMatch(/waking up or unreachable/);
    expect(describeSpaceError('Please upload a person image')).toMatchObject({ retryable: false, quota: false });
  });
});

describe('queue status', () => {
  it('says where the shopper is in line, with proper ordinals', async () => {
    const { describeStatus, ordinal } = await load();
    expect(describeStatus({ kind: 'running' })).toBe('Dressing you…');
    expect(describeStatus({ kind: 'queued', position: 0, etaS: 23 })).toBe('Dressing you…'); // gradio: pending at 0 = processing
    expect(describeStatus({ kind: 'queued', position: 2, etaS: 80 })).toBe('3rd in line · about 1 min');
    expect(describeStatus({ kind: 'queued', position: null, etaS: null })).toBe('Waiting for the free GPU…');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe('runSpace', () => {
  it('returns the result image and reports the queue', async () => {
    const { runSpace } = await load();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['out'], { type: 'image/webp' }))));
    const statuses: unknown[] = [];
    const result = runSpace(blob(), blob(), 'tops', 'flat-lay', (s) => statuses.push(s));
    job.push({ type: 'status', stage: 'pending', position: 2, eta: 70 });
    job.push({ type: 'data', data: [{ url: 'https://space/file=out.webp' }] });
    expect(await (await result).text()).toBe('out');
    expect(statuses).toEqual([{ kind: 'queued', position: 2, etaS: 70 }]);
  });

  it('gives up on a Space that stops making progress, and leaves the queue', async () => {
    const { runSpace, NO_PROGRESS_MS, warmUp } = await load();
    await warmUp(); // connect with real timers, then fake them
    vi.useFakeTimers();
    const result = runSpace(blob(), blob(), 'tops', 'flat-lay', () => undefined);
    const caught = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(NO_PROGRESS_MS + 10);
    expect(await caught).toMatchObject({ retryable: true, message: expect.stringMatching(/taking too long/) });
    expect(job.cancel).toHaveBeenCalled();
  });

  it('keeps waiting while the queue moves', async () => {
    const { runSpace, NO_PROGRESS_MS, warmUp } = await load();
    await warmUp();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['out'], { type: 'image/webp' }))));
    const result = runSpace(blob(), blob(), 'tops', 'flat-lay', () => undefined);
    for (let position = 3; position >= 0; position -= 1) {
      await vi.advanceTimersByTimeAsync(NO_PROGRESS_MS - 1000); // just under the limit each time, 4 x 119 s in all
      job.push({ type: 'status', stage: 'pending', position, eta: 30 });
    }
    job.push({ type: 'data', data: [{ url: 'https://space/file=out.webp' }] });
    expect(await (await result).text()).toBe('out');
  });

  it('gives up after the total limit even if the queue keeps moving', async () => {
    const { runSpace, NO_PROGRESS_MS, PASS_LIMIT_MS, warmUp } = await load();
    await warmUp();
    vi.useFakeTimers();
    const caught = runSpace(blob(), blob(), 'tops', 'flat-lay', () => undefined).catch((e: unknown) => e);
    for (let t = 0, position = 50; t < PASS_LIMIT_MS + NO_PROGRESS_MS; t += 60_000, position -= 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      job.push({ type: 'status', stage: 'pending', position, eta: 600 });
    }
    expect(await caught).toMatchObject({ detail: 'over 10 minutes' });
  });

  it('stops at once when cancelled', async () => {
    const { runSpace } = await load();
    const controller = new AbortController();
    const result = runSpace(blob(), blob(), 'tops', 'flat-lay', () => undefined, controller.signal).catch((e: unknown) => e);
    for (let i = 0; i < 100 && !job.submitted; i += 1) await new Promise((r) => setTimeout(r, 1)); // queued, then cancel
    controller.abort();
    expect(await result).toMatchObject({ cancelled: true, retryable: true });
    expect(job.cancel).toHaveBeenCalled();
  });

  it('cancelling before the job is even submitted still stops it', async () => {
    const { runSpace } = await load();
    const controller = new AbortController();
    controller.abort();
    expect(await runSpace(blob(), blob(), 'tops', 'flat-lay', () => undefined, controller.signal).catch((e: unknown) => e)).toMatchObject({ cancelled: true });
    expect(job.submitted).toBe(false);
  });

  it("turns the Space's error event into a message", async () => {
    const { runSpace } = await load();
    const result = runSpace(blob(), blob(), 'bottoms', 'model', () => undefined).catch((e: unknown) => e);
    job.push({ type: 'status', stage: 'error', message: 'This application is currently busy. Please try again.' });
    expect(await result).toMatchObject({ retryable: true, message: expect.stringMatching(/busy right now/) });
  });
});

describe('garment photos', () => {
  it('routes UNIQLO product photos through the same-site proxy', async () => {
    const { garmentUrl } = await load();
    expect(garmentUrl('https://image.uniqlo.com/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg')).toBe(
      '/uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg',
    );
  });
});
