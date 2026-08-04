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

const TABS = [
  { key: 'overview', label: 'Översikt', View: Overview },
  { key: 'costs', label: 'Kostnader', View: RecurringCosts },
  { key: 'oneoff', label: 'Engång', View: OneOffCosts },
  { key: 'loans', label: 'Lån', View: Loans },
  { key: 'income', label: 'Inkomst', View: Income },
] as const;

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
  const { signedIn, budget, loading, error } = useStore();
  const hash = useHash();

  if (loading) return <p className="empty">Hämtar budgeten…</p>;
  if (!signedIn) return <SignIn />;
  if (!budget) return <Onboarding />;

  const tab = TABS.find((t) => t.key === hash);
  const View = hash === 'household' ? Household : (tab?.View ?? Overview);
  const title = hash === 'household' ? 'Hushåll' : (tab?.label ?? 'Översikt');

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
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`#${t.key}`}
            className={hash === t.key ? 'active' : ''}
            aria-current={hash === t.key ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
