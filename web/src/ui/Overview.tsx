import { useMemo, useState } from 'react';
import { useBudget } from '../store/store';
import { calculateMonth, forecast, savingsTotal } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth } from '../domain/month';
import { Card, Empty, Field, MonthInput, Note, Stat } from './components';
import { ForecastChart, ForecastTable } from './ForecastChart';
import { IncomeBanner } from './IncomeBanner';
import { useText } from '../i18n';

const FORECAST_MONTHS = 24;

export function Overview() {
  const { budget, me } = useBudget();
  const t = useText();
  const [month, setMonth] = useState(currentMonth());
  const [showTable, setShowTable] = useState(false);

  const result = useMemo(() => calculateMonth(budget, month), [budget, month]);
  const points = useMemo(() => forecast(budget, FORECAST_MONTHS), [budget]);

  const isEmpty =
    budget.recurringCosts.length === 0 && budget.loans.length === 0 && budget.members.length <= 1;

  return (
    <>
      <IncomeBanner />

      {isEmpty && (
        <Card title={t.getStarted}>
          <Note>
            {t.getStartedNote}
          </Note>
        </Card>
      )}

      <Card title={t.monthLabel}>
        <Field label={t.showing}>
          <MonthInput value={month} onChange={setMonth} />
        </Field>
        <div className="hero">
          <span className="value">{sek(result.surplus)}</span>
          <span className="label">
            {t.leftToSplit(result.memberLines.length)}{' '}
            <strong>{sek(result.surplusPerMember)}</strong> {t.each}
          </span>
        </div>
      </Card>

      <Card title={t.expenses}>
        <div className="stat-grid">
          <Stat label={t.incomes} value={sek(result.totalIncome)} />
          <Stat label={t.expenses} value={sek(result.totalCosts)} />
          <Stat label={t.shared} value={sek(result.recurringTotal)} />
          <Stat label={t.loans} value={sek(result.loanTotal)} />
          <Stat label={t.oneOffCosts} value={sek(result.oneOffTotal)} />
          <Stat
            label={t.balance}
            value={sek(result.surplus)}
            tone={result.surplus < 0 ? 'negative' : 'positive'}
          />
        </div>
      </Card>

      <Card title={`${t.toTransfer} · ${formatMonth(month)}`}>
        {result.memberLines.length === 0 ? (
          <Empty text={t.noActiveMembers} />
        ) : (
          result.memberLines.map((line) => {
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

      <Card
        title={t.jointAccountAhead}
        action={
          points.length > 0 ? (
            <button className="btn btn-small btn-secondary" onClick={() => setShowTable((v) => !v)}>
              {showTable ? t.chart : t.table}
            </button>
          ) : undefined
        }
      >
        {points.length === 0 ? (
          <Empty text={t.forecastEmpty} />
        ) : showTable ? (
          <ForecastTable points={points} />
        ) : (
          <ForecastChart points={points} />
        )}
      </Card>
    </>
  );
}
