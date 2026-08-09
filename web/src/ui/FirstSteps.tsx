import { useState } from 'react';
import { useBudget } from '../store/store';
import type { MonthResult } from '../domain/engine';
import type { Budget, Member } from '../domain/types';
import { livesAlone, rememberLivesAlone } from '../settings';
import { AmountInput } from './components';
import { useText } from '../i18n';

export type FirstStep = 'income' | 'cost' | 'member' | null;

/**
 * The one question still worth asking, or null once the household can answer its
 * own. Derived from the data rather than a stored step, so there is nothing to
 * migrate and nothing to get stuck on.
 *
 * Shared with the income banner, which stays quiet until this is done: two income
 * questions on one screen is the thing this was meant to prevent.
 */
export function nextFirstStep(budget: Budget, me: Member, alone: boolean): FirstStep {
  if (me.baselineIncome === 0) return 'income';
  if (budget.recurringCosts.length === 0 && budget.loans.length === 0) return 'cost';
  if (budget.members.length === 1 && !alone) return 'member';
  return null;
}

/**
 * True when the app has nothing to work out: no income anywhere and nothing being
 * paid for. Stating a zero here would be a confident answer to a question with no
 * data behind it, which is worse than saying there is nothing yet.
 */
export function nothingToComputeYet(result: MonthResult): boolean {
  return result.totalIncome === 0 && result.totalCosts === 0;
}

/**
 * One question at a time, until the household can answer its own.
 *
 * Three things have to be true before the figure above means anything: someone
 * earns, something is shared, and everyone who lives here is in. Each question is
 * derived from the data rather than from a stored step, so there is nothing to
 * migrate, nothing to get stuck on, and a household that empties itself is asked
 * again rather than left with a broken number.
 *
 * The reward for answering is the figure above changing. There is no counter and
 * nothing to dismiss: a prompt disappears by being satisfied. Only the last one
 * has a way out, because living alone is an answer rather than an omission.
 */
export function FirstSteps() {
  const { budget, me, update } = useBudget();
  const t = useText();
  const [income, setIncome] = useState<number | ''>('');
  const [alone, setAlone] = useState(livesAlone);

  const step = nextFirstStep(budget, me, alone);
  if (step === null) return null;

  function saveIncome() {
    if (income === '') return;
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === me.id ? { ...m, baselineIncome: income } : m)),
    }));
  }

  function sayAlone() {
    rememberLivesAlone();
    setAlone(true);
  }

  return (
    <div className="first-step">
      {step === 'income' && (
        <>
          <p className="first-step-q">{t.askBaseline}</p>
          <span className="hint">{t.askBaselineHint}</span>
          <div className="first-step-row">
            <AmountInput value={income} onChange={setIncome} step={1000} />
            <button className="btn" disabled={income === ''} onClick={saveIncome}>
              {t.save}
            </button>
          </div>
        </>
      )}

      {step === 'cost' && (
        <>
          <p className="first-step-q">{t.askCost}</p>
          <div className="first-step-row">
            {/* Hands over to the costs section, where its own guide explains what
                belongs there. One idea per screen. */}
            <a className="btn" href="#costs">
              {t.askCostAction}
            </a>
          </div>
        </>
      )}

      {step === 'member' && (
        <>
          <p className="first-step-q">{t.askMember}</p>
          <div className="first-step-row">
            <a className="btn" href="#settings">
              {t.invite}
            </a>
            <button className="btn btn-secondary" onClick={sayAlone}>
              {t.askMemberAlone}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
