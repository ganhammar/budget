import { useMemo, useState } from 'react';
import { useBudget } from '../store/store';
import {
  bufferGoal,
  bufferTopUp,
  calculateMonth,
  forecast,
  incomeAboveNormal,
  savingsTotal,
} from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth } from '../domain/month';
import { Card, Empty, Field, MonthInput, Note, Stat } from './components';
import { ForecastChart, ForecastTable } from './ForecastChart';
import { IncomeBanner } from './IncomeBanner';
import { FirstSteps, nothingToComputeYet } from './FirstSteps';
import { useText } from '../i18n';

const FORECAST_MONTHS = 24;

export function Overview() {
  const { budget, me } = useBudget();
  const t = useText();
  const [month, setMonth] = useState(currentMonth());
  const [showTable, setShowTable] = useState(false);

  const points = useMemo(() => forecast(budget, FORECAST_MONTHS), [budget]);

  /*
   * A good month pays a little towards the buffer. Worked out here rather than in
   * the engine because it needs the account balance, which comes from the forecast,
   * which is built from the engine's own results.
   *
   * The forecast itself is left alone: future months are estimated at normal
   * income and so are never good ones, which keeps projections conservative and
   * means the buffer only ever appears once a month has actually gone well.
   */
  const topUp = useMemo(() => {
    const opening = points.find((p) => p.month === month)?.opening;
    if (opening === undefined) return 0;
    return bufferTopUp(bufferGoal(budget, month), opening, incomeAboveNormal(budget, month));
  }, [budget, month, points]);

  const result = useMemo(() => calculateMonth(budget, month, topUp), [budget, month, topUp]);

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
          <div style={{ marginBottom: 14 }}>
            <Note>{t.bufferNote(sek(result.bufferTopUp))}</Note>
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
          {showTable ? <ForecastTable points={points} /> : <ForecastChart points={points} />}
        </Card>
      )}
    </>
  );
}
