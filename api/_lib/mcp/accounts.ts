// FitRoom accounts in the ChatGPT plugin. When paid try-ons are on (api/_lib/billing.ts), ChatGPT links the shopper's
// FitRoom account (OAuth, api/oauth.ts) and try_on spends the same looks as the website (ledger.ts): the free ones,
// then the ones bought on the website; the owner and BILLING_EXEMPT_EMAILS never pay. When they are off, the plugin
// keeps its own monthly allowance per ChatGPT user (quota.ts) and nobody signs in.
// ChatGPT plugin rules (developers.openai.com/plugins/plugin-guidelines, Commerce): nothing is sold in ChatGPT, no
// checkout links, no upsells. With no try-ons left, FitRoom says so and links an informational page (try-ons.html).
import { createHash, randomUUID } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { admit, giveBack } from '../account';
import { accountView, isExempt, type AccountView, type BillingConfig } from '../billing';
import { ledger } from '../ledger';
import { authChallenge, SCOPE } from '../oauth';
import type { SessionUser } from '../session';

export interface PluginAccount {
  billing: BillingConfig;
  /** The linked FitRoom account (the request's OAuth access token), or null. */
  user: SessionUser | null;
  /** This site's origin (the OAuth issuer and the informational page). */
  origin: string;
}

export const paid = (account: PluginAccount | undefined): account is PluginAccount => Boolean(account?.billing.enabled);

/** No linked account where one is needed: an error that makes ChatGPT offer to link FitRoom (needs the tool's oauth2 scheme). */
export function linkAccountResult(origin: string): CallToolResult {
  const message = 'Sign in to FitRoom to try clothes on: connect your FitRoom account (Google sign-in). Every account gets free try-ons.';
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { kind: 'tryon', status: 'signin', message, items: [] },
    _meta: { 'mcp/www_authenticate': [authChallenge(origin)] },
    isError: true,
  };
}

/** Why there are no try-ons, and where to read about them. Never a price, a pack or a checkout (plugin rules). */
export function noTryOnsText(origin: string, view: AccountView): string {
  const free = view.freeLooks;
  const used =
    free > 0
      ? `This FitRoom account has used its ${free} free try-on${free === 1 ? '' : 's'} and has none left.`
      : 'This FitRoom account has no try-ons left.';
  return `${used} Size advice still works. How try-ons work: ${origin}/try-ons.html`;
}

/** "3 try-ons left on your FitRoom account" (null for unlimited accounts). */
export function leftText(view: AccountView): string | null {
  const left = view.user?.left;
  if (left === null || left === undefined) return null;
  return `${left} try-on${left === 1 ? '' : 's'} left on your FitRoom account.`;
}

export type Charge =
  | { ok: true; view: AccountView; release: () => Promise<void> }
  | { ok: false; result: CallToolResult };

/**
 * Spends one of the linked account's looks for one try-on photo. Every call is a new paid image (FASHN API), so each
 * one counts, as with the paid generator; `release` gives it back when nothing was made.
 */
export async function chargeTryOn(account: PluginAccount): Promise<Charge> {
  const { billing, user, origin } = account;
  if (!user) return { ok: false, result: linkAccountResult(origin) };
  const who = { config: billing, user };
  const look = `m:${randomUUID()}`; // server-made ids carry a ':' so /api/credits can't name them
  const admission = await admit(who, look);
  if (!admission.ok) {
    if (admission.code === 'signin') return { ok: false, result: linkAccountResult(origin) };
    const message = admission.code === 'payment' && admission.view ? noTryOnsText(origin, admission.view) : admission.error;
    const status = admission.code === 'payment' ? 'limit' : 'unavailable';
    return {
      ok: false,
      result: {
        content: [{ type: 'text', text: message }],
        structuredContent: { kind: 'tryon', status, message, items: [], remaining: admission.view?.user?.left ?? null, remainingText: null },
        isError: true,
      },
    };
  }
  let released = false;
  return {
    ok: true,
    view: admission.view,
    release: async () => {
      if (released || !admission.charged) return;
      released = true;
      await giveBack(who, look);
    },
  };
}

// ---- Account tools (listed only while paid try-ons are on) ----

const OAUTH = [{ type: 'oauth2', scopes: [SCOPE] }];

export const ACCOUNT_TOOLS: Tool[] = [
  {
    name: 'my_try_ons',
    title: 'Try-ons left',
    description: 'How many try-ons the linked FitRoom account has left.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Try-ons left', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: OAUTH },
  },
  {
    name: 'get_profile',
    title: 'FitRoom account',
    description: 'The linked FitRoom account, so accounts can be told apart.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, nickname: { type: 'string' } }, required: ['id'] },
    annotations: { title: 'FitRoom account', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: OAUTH, 'openai/profile': true },
  },
];

/** A stable, opaque profile id for a FitRoom account (never the Google id itself). */
export const profileId = (sub: string) => `fr_${createHash('sha256').update(`fitroom-profile:${sub}`).digest('base64url').slice(0, 22)}`;

export async function viewOf(account: PluginAccount, user: SessionUser): Promise<AccountView> {
  const balance = isExempt(user.email) ? { freeUsed: 0, credits: 0 } : await ledger().balance(user.sub);
  return accountView(account.billing, { email: user.email, balance });
}

export async function callAccountTool(name: string, account: PluginAccount): Promise<CallToolResult | null> {
  if (name !== 'my_try_ons' && name !== 'get_profile') return null;
  const { user, origin } = account;
  if (!user) return linkAccountResult(origin);
  if (name === 'get_profile') {
    const profile = { id: profileId(user.sub), email: user.email, nickname: `FitRoom (${user.email})` };
    return { content: [{ type: 'text', text: JSON.stringify(profile) }], structuredContent: profile };
  }
  try {
    const view = await viewOf(account, user);
    const left = view.user?.left ?? null;
    const text = left === null ? 'Unlimited try-ons.' : left === 0 ? noTryOnsText(origin, view) : (leftText(view) ?? '');
    return { content: [{ type: 'text', text }], structuredContent: { try_ons_left: left, free_try_ons: view.freeLooks, free_used: view.user?.freeUsed ?? 0 } };
  } catch {
    return { content: [{ type: 'text', text: "Couldn't check your try-ons. Try again in a moment." }], isError: true };
  }
}

/** The tool list for this request: try_on needs the linked account while paid try-ons are on. */
export function withAccounts(tools: Tool[], account: PluginAccount | undefined): Tool[] {
  if (!paid(account)) return tools;
  const adjusted = tools.map((t) =>
    t.name !== 'try_on'
      ? t
      : {
          ...t,
          description: (t.description ?? '').replace(
            /free photos are limited per person per\s+month\./,
            "each new photo uses one of the user's FitRoom try-ons (their FitRoom account, linked by signing in).",
          ),
          _meta: { ...(t._meta ?? {}), securitySchemes: OAUTH },
        },
  );
  return [...adjusted, ...ACCOUNT_TOOLS];
}
