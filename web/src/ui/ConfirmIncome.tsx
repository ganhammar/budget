import { useState } from 'react';
import { useBudget } from '../store/store';
import type { Month } from '../domain/types';
import { sek } from '../domain/format';
import { AmountInput } from './components';

/**
 * The one control for answering "what did you get this month". Shared by the
 * banner on the overview and the income tab so the question looks and behaves
 * the same wherever it is asked. It only ever writes your own figure; filling in
 * for someone else goes through the editor sheet.
 */
export function ConfirmIncome({ month }: { month: Month }) {
  const { me, update } = useBudget();
  const [amount, setAmount] = useState<number | ''>(me.baselineIncome || '');

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

  return (
    <>
      <div className="ask-input">
        <AmountInput value={amount} onChange={setAmount} step={100} />
        <button className="btn" onClick={confirm}>
          Bekräfta
        </button>
      </div>
      <span className="hint">
        {me.baselineIncome > 0
          ? `Normalt ${sek(me.baselineIncome)}. Du kan ändra det senare.`
          : 'Du kan ändra det senare.'}
      </span>
    </>
  );
}
