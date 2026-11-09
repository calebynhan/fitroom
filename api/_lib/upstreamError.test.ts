import { describe, expect, it } from 'vitest';
import { describeTimeout, describeUpstreamError, redact } from './upstreamError';

const body = (message: string, extra: Record<string, unknown> = {}) => ({ error: { message, ...extra } });

describe('redact', () => {
  it('hides organization ids and API key fragments', () => {
    const out = redact('Limit 0 in organization org-eRFkqeB5QNBjTOZnJhlcCq23 for key sk-proj-abc123XYZ');
    expect(out).not.toContain('eRFkqeB5');
    expect(out).not.toContain('abc123XYZ');
    expect(out).toContain('org-…');
  });
  it('trims and caps length', () => {
    expect(redact(`  ${'x'.repeat(500)}  `).length).toBeLessThanOrEqual(240);
  });
  it('drops links and cuts long text at a sentence boundary', () => {
    const msg =
      'Request too large for gpt-image-1.5 (for limit gpt-image) in organization org-x on tokens per min (TPM): Limit 0, Requested 1930. ' +
      'The input or output tokens must be reduced in order to run successfully. Visit https://platform.openai.com/account/rate-limits to learn more. ' +
      'You can increase your rate limit by adding a payment method to your account at https://platform.openai.com/account/billing.';
    const out = redact(msg);
    expect(out).not.toContain('https://');
    expect(out).toMatch(/\.$/);
    expect(out).toContain('Limit 0, Requested 1930.');
    expect(out.length).toBeLessThanOrEqual(240);
  });
});

describe('describeUpstreamError', () => {
  it('explains a zero image quota (free-tier org) and does not offer retry', () => {
    const msg =
      'Request too large for gpt-image-1.5 (for limit gpt-image) in organization org-abc on tokens per min (TPM): Limit 0, Requested 2071.';
    const out = describeUpstreamError(429, body(msg, { type: 'tokens', code: 'rate_limit_exceeded' }));
    expect(out.error).toMatch(/no image credit/i);
    expect(out.retryable).toBe(false);
    expect(out.status).toBe(503);
    expect(out.detail).toContain('Limit 0');
    expect(out.detail).not.toContain('org-abc');
  });

  it('treats insufficient_quota as out of credit', () => {
    const out = describeUpstreamError(429, body('You exceeded your current quota', { code: 'insufficient_quota' }));
    expect(out.error).toMatch(/no image credit/i);
    expect(out.retryable).toBe(false);
  });

  it('treats an ordinary rate limit as busy and retryable', () => {
    const out = describeUpstreamError(429, body('Rate limit reached for gpt-image-1.5: Limit 5, Used 5', { code: 'rate_limit_exceeded' }));
    expect(out.error).toMatch(/busy/i);
    expect(out.retryable).toBe(true);
  });

  it('flags a rejected API key as a setup problem', () => {
    const out = describeUpstreamError(401, body('Incorrect API key provided', { code: 'invalid_api_key' }));
    expect(out.error).toMatch(/not set up/i);
    expect(out.retryable).toBe(false);
    expect(out.status).toBe(503);
  });

  it('flags an unverified organization', () => {
    const out = describeUpstreamError(403, body('Your organization must be verified to use the model `gpt-image-1.5`.'));
    expect(out.error).toMatch(/verif/i);
    expect(out.retryable).toBe(false);
  });

  it('explains a safety refusal and suggests other photos', () => {
    const out = describeUpstreamError(400, body('Your request was rejected by the safety system.', { code: 'moderation_blocked' }));
    expect(out.error).toMatch(/safety/i);
    expect(out.retryable).toBe(true);
    expect(out.status).toBe(422);
  });

  it('reports upstream outages as retryable', () => {
    const out = describeUpstreamError(500, body('The server had an error'));
    expect(out.retryable).toBe(true);
    expect(out.status).toBe(502);
  });

  it('copes with a body that is not an OpenAI error', () => {
    const out = describeUpstreamError(502, '<html>bad gateway</html>');
    expect(out.error.length).toBeGreaterThan(0);
    expect(out.detail).toBe('HTTP 502');
  });

  it('handles a 200 without an image', () => {
    const out = describeUpstreamError(200, { data: [] });
    expect(out.error).toMatch(/no image/i);
    expect(out.retryable).toBe(true);
  });
});

describe('describeTimeout', () => {
  it('is retryable', () => {
    expect(describeTimeout().retryable).toBe(true);
    expect(describeTimeout().error).toMatch(/too long/i);
  });
});
