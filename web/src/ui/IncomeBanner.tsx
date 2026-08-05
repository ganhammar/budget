import { useState } from 'react';
import { useBudget } from '../store/store';
import { shouldPromptForIncome } from '../domain/income';
import { currentDayOfMonth, currentMonth, formatMonth } from '../domain/month';
import { ConfirmIncome } from './ConfirmIncome';

/**
 * Asks the signed-in member for their own income once a month, from the second
 * week onwards. The income tab asks the same question in its own words; this is
 * the prompt for everywhere else.
 */
export function IncomeBanner() {
  const { budget, me } = useBudget();
  const month = currentMonth();
  // Closing it lasts for this visit only. It is a reminder, so one stray tap
  // should not silence it for the rest of the month.
  const [closed, setClosed] = useState(false);

  if (closed) return null;
  if (!shouldPromptForIncome(budget, me.id, month, currentDayOfMonth())) return null;

  return (
    <section className="banner">
      <div className="banner-head">
        <span className="banner-title">Inkomst för {formatMonth(month)}</span>
        <button className="banner-close" onClick={() => setClosed(true)} aria-label="Stäng">
          ×
        </button>
      </div>
      <p className="ask-text">Vad fick du in den här månaden?</p>
      <ConfirmIncome month={month} />
    </section>
  );
}
