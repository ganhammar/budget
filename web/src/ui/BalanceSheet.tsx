import { useState } from 'react';
import { currentMonth } from '../domain/month';
import { AmountInput, Field, MonthInput, Note, Sheet } from './components';
import { useText } from '../i18n';

/**
 * The month matters as much as the figure: the forecast starts there and counts
 * forward, so a reading from six months ago is six months of assumption.
 */
export function BalanceSheet({
  balance,
  onSave,
  onClose,
}: {
  balance: { amount: number; month: string } | null;
  onSave: (amount: number, month: string) => void;
  onClose: () => void;
}) {
  const t = useText();
  const [amount, setAmount] = useState<number | ''>(balance?.amount ?? '');
  const [month, setMonth] = useState(balance?.month ?? currentMonth());

  return (
    <Sheet title={t.jointAccount} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <Note>{t.balanceNote}</Note>
      </div>

      <Field label={t.balanceField}>
        <AmountInput value={amount} onChange={setAmount} step={100} />
      </Field>

      <Field label={t.appliesToMonth}>
        <MonthInput value={month} onChange={setMonth} />
      </Field>

      <button
        className="btn"
        disabled={amount === ''}
        onClick={() => onSave(Number(amount), month)}
      >
        {t.save}
      </button>
    </Sheet>
  );
}
