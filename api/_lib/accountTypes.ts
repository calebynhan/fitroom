// The account as the browser sees it (GET /api/account and every billing answer). Types only, shared with web/ (no
// Node imports here: the browser build reads this file).

/** A person's looks: free ones used so far and paid ones left. */
export interface Balance {
  freeUsed: number;
  credits: number;
}

export interface AccountView {
  /** Free looks are counted and a paywall follows. False: everything is free and nobody needs to sign in. */
  billing: boolean;
  /** For Google Sign-In in the browser. */
  googleClientId: string | null;
  freeLooks: number;
  /** The pack on sale, or null when buying isn't set up yet. */
  pack: { looks: number; price: string } | null;
  user: AccountUser | null;
}

export interface AccountUser {
  email: string;
  /** Never pays (the owner, BILLING_EXEMPT_EMAILS). */
  exempt: boolean;
  freeUsed: number;
  /** Paid looks left. */
  credits: number;
  /** Looks left in all (free + paid); null = unlimited. */
  left: number | null;
}

/** Why a billing request was refused: sign in first, buy more looks, or the ledger/Stripe is down. */
export type BillingCode = 'signin' | 'payment' | 'unavailable';
