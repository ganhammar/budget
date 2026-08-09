import { useMemo, useState } from 'react';
import { useBudget } from '../store/store';
import {
  bufferSkipped,
  calculateMonth,
  estimatedBalance,
  forecast,
  savingsTotal,
} from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth } from '../domain/month';
import { Card, Empty, Field, MonthInput, Note, Stat } from './components';
import { BalanceSheet } from './BalanceSheet';
import { ForecastChart, ForecastTable } from './ForecastChart';
import { IncomeBanner } from './IncomeBanner';
import { FirstSteps, nothingToComputeYet } from './FirstSteps';
import { useText } from '../i18n';

const FORECAST_MONTHS = 24;

export function Overview() {
  const { budget, me, update } = useBudget();
  const t = useText();
  const [month, setMonth] = useState(currentMonth());
  const [showTable, setShowTable] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);

  const points = useMemo(() => forecast(budget, FORECAST_MONTHS), [budget]);

  // Read from the forecast rather than worked out again here, so the figure in the
  // transfer and the figure in the chart can never disagree.
  const topUp = points.find((p) => p.month === month)?.bufferTopUp ?? 0;
  const skipped = bufferSkipped(budget, month);
  const estimated = estimatedBalance(budget, currentMonth());

  const result = useMemo(() => calculateMonth(budget, month, topUp), [budget, month, topUp]);

  function setSkipped(skip: boolean) {
    update((b) => {
      const rest = (b.household.bufferSkipped ?? []).filter((m) => m !== month);
      return {
        ...b,
        household: { ...b.household, bufferSkipped: skip ? [...rest, month] : rest },
      };
    });
  }

  // Nothing has been entered at all, so there is no figure to state. A zero here
  // is a confident answer to a question the app has no data for.
  const blank = nothingToComputeYet(result);

  return (
    <>
      <IncomeBanner />

      <Card title={t.monthLabel}>
        <Field label={t.showing}>
          <MonthInput value={month} onChange={setMonth} />
        </Field>
        <div className="hero">
          {blank ? (
            <span className="label" style={{ marginTop: 0 }}>
              {t.nothingToCompute}
            </span>
          ) : (
            <>
          <span className="value">{sek(result.surplus)}</span>
          {/* "each" is only true when the rule is an equal amount left over; under
              the others the leftovers differ and naming one figure would mislead. */}
          <span className="label">
            {result.memberLines.length === 1 ? (
              t.leftForOne
            ) : (budget.household.split ?? 'equalLeftover') === 'equalLeftover' ? (
              <>
                {t.leftToSplit(result.memberLines.length)}{' '}
                <strong>{sek(result.surplusPerMember)}</strong> {t.each}
              </>
            ) : (
              t.leftAfterCosts
            )}
          </span>
            </>
          )}
        </div>

        <FirstSteps />
      </Card>

      {!blank && (
      <Card title={t.expenses}>
        <div className="stat-grid">
          <Stat label={t.incomes} value={sek(result.totalIncome)} />
          <Stat label={t.expenses} value={sek(result.totalCosts)} />
          <Stat label={t.shared} value={sek(result.recurringTotal)} />
          <Stat label={t.loans} value={sek(result.loanTotal)} />
          <Stat label={t.oneOffCosts} value={sek(result.oneOffTotal)} />
          {result.bufferTopUp > 0 && (
            <Stat label={t.buffer} value={sek(result.bufferTopUp)} />
          )}
          <Stat
            label={t.balance}
            value={sek(result.surplus)}
            tone={result.surplus < 0 ? 'negative' : 'positive'}
          />
        </div>
      </Card>
      )}

      {!blank && (
      <Card title={`${t.toTransfer} · ${formatMonth(month)}`}>
        {/* Said once, at the top, rather than as a line inside each person's block.
            It is one decision the household made about a shared account, and a
            transfer that quietly grew is the fastest way to stop trusting a budget. */}
        {result.bufferTopUp > 0 && (
          <div className="buffer-note">
            <Note>{t.bufferNote(sek(result.bufferTopUp))}</Note>
            <button className="btn btn-small btn-secondary" onClick={() => setSkipped(true)}>
              {t.skipBuffer}
            </button>
          </div>
        )}

        {/* A month that opted out says so, and can change its mind. Silence would
            look like the month simply was not good enough. */}
        {skipped && (
          <div className="buffer-note">
            <Note>{t.bufferSkipped}</Note>
            <button className="btn btn-small btn-secondary" onClick={() => setSkipped(false)}>
              {t.undoSkipBuffer}
            </button>
          </div>
        )}
        {result.memberLines.length === 0 ? (
          <Empty text={t.noActiveMembers} />
        ) : (
          // Your own block first: it is the one you came to read.
          [...result.memberLines]
            .sort((a, b) => Number(b.memberId === me.id) - Number(a.memberId === me.id))
            .map((line) => {
            // Only your own block can carry this: another member's savings never
            // reach this client, so there is nothing to leak or to hide.
            const savings = line.memberId === me.id ? savingsTotal(budget, month) : 0;
            return (
            <div className="transfer" key={line.memberId}>
              <div className="transfer-name">{line.name}</div>
              <div className="transfer-headline">
                <span className="label">{t.toJointAccount}</span>
                <span className={`value ${line.toTransfer < 0 ? 'negative' : ''}`}>
                  {sek(line.toTransfer)}
                </span>
              </div>
              <div className="transfer-line">
                <span>{t.income}</span>
                <span>{sek(line.income)}</span>
              </div>
              <div className="transfer-line">
                <span>{t.paysDirectly}</span>
                <span>{line.paidDirectly > 0 ? `−${sek(line.paidDirectly)}` : '—'}</span>
              </div>
              {savings > 0 && (
                <div className="transfer-line">
                  <span>{t.savings}</span>
                  <span>−{sek(savings)}</span>
                </div>
              )}
              <div className="transfer-line">
                <span>{savings > 0 ? t.leftAfterSavings : t.leftForYourself}</span>
                <span>{sek(line.leftOver - savings)}</span>
              </div>
            </div>
            );
          })
        )}
        <div style={{ marginTop: 12 }}>
          <Note>
            {t.transferNote}
          </Note>
        </div>
      </Card>
      )}

      {editingBalance && (
        <BalanceSheet
          balance={budget.accountBalance ?? null}
          onSave={(amount, balanceMonth) => {
            update((b) => ({ ...b, accountBalance: { amount, month: balanceMonth } }));
            setEditingBalance(false);
          }}
          onClose={() => setEditingBalance(false)}
        />
      )}

      {/* Without a recorded balance there is nothing to count forward from, and a
          card explaining its own absence is worse than no card. Recording one is
          in household settings, where the rest of the joint account lives. */}
      {points.length > 0 && (
        <Card
          title={t.jointAccountAhead}
          action={
            <button className="btn btn-small btn-secondary" onClick={() => setShowTable((v) => !v)}>
              {showTable ? t.chart : t.table}
            </button>
          }
        >
          {/* Where the account stands now, before the line ahead of it. The entered
              reading is a date and a figure; this is what has happened since. */}
          {estimated !== null && (
            <div className="estimated-now">
              <div className="estimated-head">
                <span className="label">{t.estimatedToday}</span>
                <span className="value">{sek(estimated)}</span>
              </div>
              {/* Worked forward from a figure someone typed once, so the way to
                  correct it belongs next to it rather than three taps away. */}
              <p className="estimated-correct">
                {t.estimatedWrong}{' '}
                <button className="linkish" onClick={() => setEditingBalance(true)}>
                  {t.estimatedUpdate}
                </button>
              </p>
            </div>
          )}
          {showTable ? <ForecastTable points={points} /> : <ForecastChart points={points} />}
        </Card>
      )}
    </>
  );
}
