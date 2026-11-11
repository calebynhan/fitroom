// Google Sign-In (Google Identity Services): loaded only when a sign-in button is shown, so shoppers who never need
// one never load Google's script. The button gives us an ID token; /api/account checks it and signs the shopper in.
// The site's origins must be listed on the OAuth client ("Authorized JavaScript origins") or Google refuses the button.
import { signIn } from './store';

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 15_000;

interface GoogleId {
  initialize(config: { client_id: string; callback: (response: { credential?: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let loading: Promise<GoogleId> | null = null;
let initializedFor: string | null = null;

function loadScript(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!loading) {
    loading = new Promise<GoogleId>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
      script.onload = () => {
        window.clearTimeout(timer);
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else reject(new Error('no google.accounts.id'));
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('script failed'));
      };
      document.head.appendChild(script);
    });
    loading.catch(() => {
      loading = null; // let the next button try again
    });
  }
  return loading;
}

/** Draws Google's "Sign in with Google" button into `parent`. Rejects if Google's script can't load. */
export async function renderGoogleButton(parent: HTMLElement, clientId: string): Promise<void> {
  const id = await loadScript();
  if (initializedFor !== clientId) {
    id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) void signIn(response.credential);
      },
      cancel_on_tap_outside: true,
    });
    initializedFor = clientId;
  }
  parent.replaceChildren();
  id.renderButton(parent, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', width: 260 });
}
