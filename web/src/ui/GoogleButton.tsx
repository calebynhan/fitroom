import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from '../account/google';

/** Google's own "Sign in with Google" button (their branding rules), loaded on first show. */
export function GoogleButton({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    setFailed(false);
    renderGoogleButton(ref.current, clientId).catch((err: unknown) => {
      console.error('[account] Google sign-in failed to load', err);
      setFailed(true);
    });
  }, [clientId]);
  return (
    <>
      <div ref={ref} className="google-button" />
      {failed && (
        <p className="note warn" role="alert">
          Couldn't load Google sign-in. Check your connection (or an ad blocker), then reload the page.
        </p>
      )}
    </>
  );
}
