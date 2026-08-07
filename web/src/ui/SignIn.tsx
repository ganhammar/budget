import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { Note } from './components';
import { useText } from '../i18n';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
/** Matches the clip in .landing-button; Google's frame around it is clipped away. */
const BUTTON_WIDTH = 280;
const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
      }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gsi')));
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('gsi'));
    document.head.appendChild(script);
  });
}

/**
 * The public face of the app, so it says almost nothing: a wordmark, one line,
 * and a way in. Nobody arrives here by accident, and a household's finances are
 * not something to advertise, so there is nothing to explain to a stranger.
 *
 * Google's script is only fetched once someone asks to sign in, so a visitor who
 * never clicks is never handed to a third party.
 */
export function SignIn() {
  const { signIn, error } = useStore();
  const t = useText();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!opening || !CLIENT_ID) return;
    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => void signIn(response.credential),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          // Google paints the frame it renders into, and no option controls that,
          // so the container clips it. Matching the button to the page at least
          // means what survives the clip belongs here.
          theme: document.documentElement.dataset.theme === 'dark' ? 'outline_dark' : 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'sv',
          width: BUTTON_WIDTH,
        });
      })
      .catch(() => {
        /* The fallback message below covers this. */
      });

    return () => {
      cancelled = true;
    };
  }, [opening, signIn]);

  return (
    <div className="landing">
      <div className="landing-mark">
        pnkt<span className="landing-dot">.</span>
      </div>
      <p className="landing-line">{t.tagline}</p>

      {!CLIENT_ID ? (
        <Note>
          {t.signInMissingClient} <code>VITE_GOOGLE_CLIENT_ID</code> {t.signInMissingClientTail}
        </Note>
      ) : opening ? (
        <div ref={buttonRef} className="landing-button" />
      ) : (
        <button className="landing-link" onClick={() => setOpening(true)}>
          {t.signIn}
        </button>
      )}

      {error && <p className="note error landing-error">{error}</p>}
    </div>
  );
}
