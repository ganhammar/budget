import { useEffect, useState } from 'react';
import { useStore, useBudget } from '../store/store';
import type { Language, ThemeChoice } from '../domain/types';
import { defaultLanguage, rememberLanguage } from '../settings';
import { Card, Field, Note } from './components';
import { Savings } from './Savings';
import { api } from '../api/client';
import { currentSubscription, disablePush, enablePush, needsInstall, pushSupported } from '../push';
import { useText } from '../i18n';

/** Everything that is yours rather than the household's. */
export function Profile() {
  const { me, update } = useBudget();
  const { signOut, email: signedInEmail } = useStore();
  const t = useText();

  function setLanguage(language: Language) {
    rememberLanguage(language);
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === me.id ? { ...m, language } : m)),
    }));
  }

  function setTheme(theme: ThemeChoice) {
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === me.id ? { ...m, theme } : m)),
    }));
  }

  return (
    <>
      <Savings />

      <Card title={t.preferences}>
        <Field label={t.language}>
          <select
            value={me.language ?? defaultLanguage()}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label={t.appearance}>
          <select
            value={me.theme ?? 'system'}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">{t.themeSystem}</option>
            <option value="light">{t.themeLight}</option>
            <option value="dark">{t.themeDark}</option>
          </select>
        </Field>

        <Notifications />
      </Card>

      {/* Who you are signed in as and how to stop: an end-of-page action rather
          than a preference, so it sits outside the card that names them. */}
      <div className="account-footer">
        <Note>
          {t.signedInAs} <strong>{signedInEmail}</strong> {t.signedInVia}
        </Note>
        <button className="btn btn-secondary" onClick={() => void signOut()}>
          {t.signOut}
        </button>
      </div>
    </>
  );
}

/**
 * The state shown is the browser's own subscription, read on mount rather than
 * remembered: permission can be revoked and site data cleared without the app
 * hearing about it, and a toggle that claims to be on when nothing will arrive is
 * worse than no toggle.
 */
function Notifications() {
  const t = useText();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supported = pushSupported();
  const install = !supported && needsInstall();

  useEffect(() => {
    void currentSubscription().then((s) => setEnabled(s !== null));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      if (next) await enablePush();
      else await disablePush();
      setEnabled(next);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'denied'
          ? t.notificationsDenied
          : t.notificationsFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      await api.sendTestPush();
      setMessage(t.testSent);
    } catch {
      setMessage(t.testFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <Field label={t.notifications}>
        <Note>{install ? t.notificationsInstall : t.notificationsUnsupported}</Note>
      </Field>
    );
  }

  return (
    <Field label={t.notifications}>
      <label className="toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t.notificationsOn}
      </label>

      {enabled && (
        <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => void test()}>
          {t.sendTest}
        </button>
      )}

      {/* One line of secondary text in one place: what the setting does, or what
          just happened to it. */}
      <span className="hint">{message ?? t.notificationsHint}</span>
    </Field>
  );
}
