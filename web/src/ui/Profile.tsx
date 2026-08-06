import { useStore, useBudget } from '../store/store';
import type { Language, ThemeChoice } from '../domain/types';
import { defaultLanguage, rememberLanguage } from '../settings';
import { Card, Field, Note } from './components';
import { Savings } from './Savings';
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

      <Card title={t.account}>
        <div style={{ marginBottom: 12 }}>
          <Note>
            {t.signedInAs} <strong>{signedInEmail}</strong> {t.signedInVia}
          </Note>
        </div>

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

        <button className="btn btn-secondary" onClick={() => void signOut()}>
          {t.signOut}
        </button>
      </Card>
    </>
  );
}
