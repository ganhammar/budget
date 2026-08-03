import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';
import { Note } from './components';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
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
challenge?: string;
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

export function SignIn() {
  const { signIn, error } = useStore();
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => void signIn(response.credential),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'sv',
          width: 280,
        });
      })
      .catch(() => {
        /* The fallback message below covers this. */
      });

    return () => {
      cancelled = true;
    };
  }, [signIn]);

  return (
    <div className="onboarding">
      <h1>Budget</h1>
      <p className="lead">Logga in för att se hushållets budget.</p>

      {CLIENT_ID ? (
        <div ref={buttonRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      ) : (
        <Note>
          Google-inloggning är inte konfigurerad. <code>VITE_GOOGLE_CLIENT_ID</code> saknas i
          bygget.
        </Note>
      )}

      {error && (
        <div style={{ marginTop: 16 }}>
          <p className="note error">{error}</p>
        </div>
      )}
    </div>
  );
}
