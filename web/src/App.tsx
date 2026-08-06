import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { SignIn } from './ui/SignIn';
import { Onboarding } from './ui/Onboarding';
import { Overview } from './ui/Overview';
import { RecurringCosts } from './ui/RecurringCosts';
import { OneOffCosts } from './ui/OneOffCosts';
import { Loans } from './ui/Loans';
import { Income } from './ui/Income';
import { Settings } from './ui/Settings';
import { storedTheme, useTheme } from './settings';
import { Loading } from './ui/Loading';
import { useText, type Text } from './i18n';

const TABS = [
  { key: 'overview', View: Overview },
  { key: 'costs', View: RecurringCosts },
  { key: 'oneoff', View: OneOffCosts },
  { key: 'loans', View: Loans },
  { key: 'income', View: Income },
] as const;

function tabLabel(t: Text, key: (typeof TABS)[number]['key']): string {
  return {
    overview: t.navOverview,
    costs: t.navCosts,
    oneoff: t.navOneOff,
    loans: t.navLoans,
    income: t.navIncome,
  }[key];
}

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || 'overview');
  useEffect(() => {
    const onChange = () => setHash(location.hash.slice(1) || 'overview');
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const { signedIn, budget, loading, error, me } = useStore();
  const hash = useHash();

  // Falls back to the local mirror rather than 'system' while the budget loads,
  // or an explicit choice would be overridden by the OS for the first moment.
  useTheme(me?.theme ?? storedTheme());
  const t = useText();

  if (loading) return <Loading label={t.loadingBudget} />;
  if (!signedIn) return <SignIn />;
  if (!budget) return <Onboarding />;

  const tab = TABS.find((entry) => entry.key === hash);
  const View = hash === 'settings' ? Settings : (tab?.View ?? Overview);
  const title = hash === 'settings' ? t.settings : tab ? tabLabel(t, tab.key) : t.navOverview;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <a href="#settings" className="cog" aria-label={t.settings}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M18.49,8.65 L18.49,11.35 L16.22,11.49 L15.46,13.34 L16.96,15.05 L15.05,16.96 L13.34,15.46 L11.49,16.22 L11.35,18.49 L8.65,18.49 L8.51,16.22 L6.66,15.46 L4.95,16.96 L3.04,15.05 L4.54,13.34 L3.78,11.49 L1.51,11.35 L1.51,8.65 L3.78,8.51 L4.54,6.66 L3.04,4.95 L4.95,3.04 L6.66,4.54 L8.51,3.78 L8.65,1.51 L11.35,1.51 L11.49,3.78 L13.34,4.54 L15.05,3.04 L16.96,4.95 L15.46,6.66 L16.22,8.51 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </a>
      </header>

      <main className="content">
        {error && <p className="note error">{error}</p>}
        <View />
      </main>

      <nav className="nav">
        {TABS.map((tab2) => (
          <a
            key={tab2.key}
            href={`#${tab2.key}`}
            className={hash === tab2.key ? 'active' : ''}
            aria-current={hash === tab2.key ? 'page' : undefined}
          >
            {tabLabel(t, tab2.key)}
          </a>
        ))}
      </nav>
    </div>
  );
}
