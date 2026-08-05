import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { SignIn } from './ui/SignIn';
import { Onboarding } from './ui/Onboarding';
import { Overview } from './ui/Overview';
import { RecurringCosts } from './ui/RecurringCosts';
import { OneOffCosts } from './ui/OneOffCosts';
import { Loans } from './ui/Loans';
import { Income } from './ui/Income';
import { Household } from './ui/Household';
import { storedTheme, useTheme } from './settings';
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

  if (loading) return <p className="empty">{t.loadingBudget}</p>;
  if (!signedIn) return <SignIn />;
  if (!budget) return <Onboarding />;

  const tab = TABS.find((entry) => entry.key === hash);
  const View = hash === 'household' ? Household : (tab?.View ?? Overview);
  const title = hash === 'household' ? t.household : tab ? tabLabel(t, tab.key) : t.navOverview;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <a href="#household">{budget.household.name} ›</a>
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
