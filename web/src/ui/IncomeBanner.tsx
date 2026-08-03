import { useState } from 'react';
import { useBudget } from '../store/store';
import { shouldPromptForIncome } from '../domain/income';
import { sek } from '../domain/format';
import { currentDayOfMonth, currentMonth, formatMonth } from '../domain/month';
import { AmountInput } from './components';

/**
 * Asks the signed-in member for their own income once a month, from the second
 * week onwards. Closing it stores the dismissal so it stays closed everywhere.
 */
export function IncomeBanner() {
  const { budget, me, update } = useBudget();
  const month = currentMonth();
  const [amount, setAmount] = useState<number | ''>(me.baselineIncome || '');

  if (!shouldPromptForIncome(budget, me.id, month, currentDayOfMonth())) return null;

  function confirm() {
    const value = amount === '' ? me.baselineIncome : amount;
    update((b) => ({
      ...b,
      income: [
        ...b.income.filter((i) => !(i.memberId === me.id && i.month === month)),
        { memberId: me.id, month, amount: value },
      ],
    }));
  }

  function dismiss() {
    update((b) => ({
      ...b,
      dismissedPrompts: [...b.dismissedPrompts, { memberId: me.id, month }],
    }));
  }

  return (
    <section className="banner">
      <div className="banner-head">
        <span className="banner-title">Inkomst för {formatMonth(month)}</span>
        <button className="banner-close" onClick={dismiss} aria-label="Stäng">
          ×
        </button>
      </div>
      <p className="banner-text">Vad fick du in den här månaden?</p>
      <div className="banner-input">
        <AmountInput value={amount} onChange={setAmount} step={100} />
        <button className="btn" onClick={confirm}>
          Bekräfta
        </button>
      </div>
      <span className="hint">Normalt {sek(me.baselineIncome)}. Du kan ändra det senare.</span>
    </section>
  );
}
