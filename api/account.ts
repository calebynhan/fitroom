// GET  /api/account                                   -> AccountView (billing on/off, the pack, the signed-in person)
// POST /api/account { action: "signin", credential }  -> AccountView + session cookie (credential = Google ID token)
// POST /api/account { action: "signout" }             -> AccountView, cookie cleared
// Errors: { error, code, account? } with 400 bad_input, 401 signin (token refused), 429 rate_limited, 503 unavailable.
import { asker, viewFor } from './_lib/account';
import { accountView, billingConfig } from './_lib/billing';
import { verifyGoogleIdToken } from './_lib/googleToken';
import { json, readJson } from './_lib/http';
import { clientIp } from './_lib/rateLimit';
import { clearSessionCookie, sessionCookie } from './_lib/session';
import { createWindowLimiter } from './_lib/windowLimit';

const reads = createWindowLimiter({ limit: 120, windowMs: 60_000 });
const signIns = createWindowLimiter({ limit: 20, windowMs: 60_000 });

function limited(retryAfterS: number): Response {
  return json({ error: 'Too many requests. Wait a minute and try again.', code: 'rate_limited' }, 429, { 'Retry-After': String(retryAfterS) });
}

async function answer(who: ReturnType<typeof asker>, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return json(await viewFor(who), 200, headers);
  } catch (err: unknown) {
    console.error('[api/account] ledger failed', err instanceof Error ? err.message : err);
    return json({ error: "Couldn't load your try-ons. Try again in a moment.", code: 'unavailable', account: accountView(who.config, null) }, 503, headers);
  }
}

export async function GET(request: Request): Promise<Response> {
  const verdict = reads.hit(clientIp(request));
  if (!verdict.ok) return limited(verdict.retryAfterS);
  return answer(asker(request));
}

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();
  const body = await readJson(request);
  const action = body?.action;

  if (action === 'signout') return json(accountView(config, null), 200, { 'Set-Cookie': clearSessionCookie() });
  if (action !== 'signin') return json({ error: 'Unknown action.', code: 'bad_input' }, 400);
  if (!config.enabled || !config.googleClientId || !config.sessionSecret) {
    return json({ error: "Sign-in isn't needed here: try-ons are free.", code: 'bad_input', account: accountView(config, null) }, 400);
  }
  const verdict = signIns.hit(clientIp(request));
  if (!verdict.ok) return limited(verdict.retryAfterS);

  let result;
  try {
    result = await verifyGoogleIdToken(body?.credential, config.googleClientId);
  } catch (err: unknown) {
    console.error('[api/account] Google keys unavailable', err instanceof Error ? err.message : err);
    return json({ error: "Couldn't reach Google to sign you in. Try again in a moment.", code: 'unavailable' }, 503);
  }
  if (!result.ok) {
    console.warn('[api/account] sign-in refused:', result.reason);
    return json({ error: "Google didn't confirm this sign-in. Try again.", code: 'signin' }, 401);
  }
  const user = { sub: result.identity.sub, email: result.identity.email };
  return answer({ config, user }, { 'Set-Cookie': sessionCookie(user, config.sessionSecret) });
}
